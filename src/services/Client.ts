import { nextTick } from "node:process";

import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk-gov";
import type { Abi } from "abitype";
import { Inject, Service } from "typedi";
import type {
  Address,
  Chain,
  ContractFunctionArgs,
  ContractFunctionName,
  EncodeFunctionDataParameters,
  PrivateKeyAccount,
  PublicClient,
  SimulateContractParameters,
  SimulateContractReturnType,
  TestClient,
  TestRpcSchema,
  TransactionReceipt,
  Transport,
  WalletClient,
} from "viem";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  fallback,
  formatEther,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, base, mainnet, optimism } from "viem/chains";

import { CONFIG, Config } from "../config/index.js";
import type { CreditAccountData } from "../data/index.js";
import { Logger, type LoggerInterface } from "../log/index.js";
import { INotifier, LowBalanceMessage, NOTIFIER } from "./notifier/index.js";

const GAS_TIP_MULTIPLIER = 5000n;

interface AnvilNodeInfo {
  currentBlockNumber: string; // hexutil.Big is a big number in hex format
  currentBlockTimestamp: number;
  currentBlockHash: string;
  hardFork: string;
  transactionOrder: string;
  environment: {
    baseFee: string; // big.Int is a big number, represented as string in JSON
    chainId: number;
    gasLimit: string;
    gasPrice: string;
  };
  forkConfig: {
    forkUrl: string;
    forkBlockNumber: string;
    forkRetryBackoff: number;
  };
}

type AnvilRPCSchema = [
  ...TestRpcSchema<"anvil">,
  {
    Method: "anvil_nodeInfo";
    Parameters: [];
    ReturnType: AnvilNodeInfo;
  },
];

const CHAINS: Record<NetworkType, Chain> = {
  Mainnet: mainnet,
  Arbitrum: arbitrum,
  Optimism: optimism,
  Base: base,
};

@Service()
export default class Client {
  @Inject(CONFIG)
  config: Config;

  @Inject(NOTIFIER)
  notifier: INotifier;

  @Logger("ExecutorService")
  public logger: LoggerInterface;

  #anvilInfo: AnvilNodeInfo | null = null;

  #publicClient?: PublicClient;

  #walletClient?: WalletClient<Transport, Chain, PrivateKeyAccount, undefined>;

  #testClient?: TestClient<
    "anvil",
    Transport,
    Chain,
    undefined,
    true,
    AnvilRPCSchema
  >;

  public async launch(): Promise<void> {
    const { ethProviderRpcs, chainId, network, optimistic, privateKey } =
      this.config;
    const rpcs = ethProviderRpcs.map(url => http(url, { timeout: 120_000 }));
    const transport = rpcs.length > 1 && !optimistic ? fallback(rpcs) : rpcs[0];
    const chain = defineChain({
      ...CHAINS[network],
      id: chainId,
    });

    this.#publicClient = createPublicClient({
      cacheTime: 0,
      chain,
      transport,
      pollingInterval: optimistic ? 25 : undefined,
    });
    this.#walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey),
      chain,
      transport,
      pollingInterval: optimistic ? 25 : undefined,
    });
    try {
      this.#testClient = createTestClient<
        "anvil",
        Transport,
        Chain,
        undefined,
        AnvilRPCSchema
      >({
        mode: "anvil",
        transport,
        chain,
        pollingInterval: 25,
      });
      const resp = await this.#testClient?.request({
        method: "anvil_nodeInfo",
        params: [],
      });
      this.#anvilInfo = resp;
    } catch {}
    if (this.#anvilInfo) {
      this.logger.debug(`running on anvil, fork block: ${this.anvilForkBlock}`);
    } else {
      this.logger.debug("running on real rpc");
    }
    await this.#checkBalance();
  }

  public async liquidate(
    ca: CreditAccountData,
    request: SimulateContractReturnType["request"],
  ): Promise<TransactionReceipt> {
    const logger = this.logger.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: ca.managerName,
    });
    logger.debug("sending liquidation tx");
    const { abi, address, args, dataSuffix, functionName, ...rest } = request;
    const data = encodeFunctionData({
      abi,
      args,
      functionName,
    } as EncodeFunctionDataParameters);
    const req = await this.wallet.prepareTransactionRequest({
      ...rest,
      to: request.address,
      data,
    });
    if (req.maxPriorityFeePerGas && req.maxFeePerGas) {
      const extraTip =
        (BigInt(req.maxPriorityFeePerGas) * GAS_TIP_MULTIPLIER) /
        PERCENTAGE_FACTOR;
      req.maxPriorityFeePerGas = BigInt(req.maxPriorityFeePerGas) + extraTip;
      req.maxFeePerGas = BigInt(req.maxFeePerGas) + extraTip;
      logger.debug(
        {
          maxFeePerGas: req.maxFeePerGas,
          maxPriorityFeePerGas: req.maxPriorityFeePerGas,
        },
        `increase gas fees`,
      );
    }
    const serializedTransaction = await this.wallet.signTransaction(req);
    const hash = await this.wallet.sendRawTransaction({
      serializedTransaction,
    });

    logger.debug(`sent transaction ${hash}`);
    const result = await this.pub.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
    if (!this.config.optimistic) {
      nextTick(() => {
        this.#checkBalance().catch(() => {});
      });
    }
    this.logger.debug(`got receipt for tx ${hash}: ${result.status}`);

    return result;
  }

  public async simulateAndWrite<
    const abi extends Abi | readonly unknown[],
    functionName extends ContractFunctionName<abi, "nonpayable" | "payable">,
    args extends ContractFunctionArgs<
      abi,
      "nonpayable" | "payable",
      functionName
    >,
  >(
    args: SimulateContractParameters<
      abi,
      functionName,
      args,
      undefined,
      undefined,
      Address | undefined
    >,
  ): Promise<TransactionReceipt> {
    if (args.account && !this.config.optimistic) {
      throw new Error(`not allowed to override account in non-optimistic mode`);
    }
    const account = args.account && this.account.address;
    const { request } = await this.pub.simulateContract<
      abi,
      functionName,
      args,
      undefined,
      Address
    >({
      ...args,
      account,
    });
    const hash = await this.wallet.writeContract(request as any);
    return this.pub.waitForTransactionReceipt({
      hash,
      timeout: 120_000,
    });
  }

  async #checkBalance(): Promise<void> {
    const balance = await this.pub.getBalance({ address: this.address });
    this.logger.debug(`liquidator balance is ${formatEther(balance)}`);
    if (balance < this.config.minBalance) {
      this.notifier.alert(
        new LowBalanceMessage(this.address, balance, this.config.minBalance),
      );
    }
  }

  public get pub(): PublicClient {
    if (!this.#publicClient) {
      throw new Error("public client not initialized");
    }
    return this.#publicClient;
  }

  public get wallet(): WalletClient<
    Transport,
    Chain,
    PrivateKeyAccount,
    undefined
  > {
    if (!this.#walletClient) {
      throw new Error("wallet client not initialized");
    }
    return this.#walletClient;
  }

  public get anvil(): TestClient<
    "anvil",
    Transport,
    Chain,
    undefined,
    true,
    AnvilRPCSchema
  > {
    if (!this.config.optimistic) {
      throw new Error("test config is only available in optimistic mode");
    }
    if (!this.#testClient) {
      throw new Error("test client not initialized");
    }
    return this.#testClient;
  }

  public get account(): PrivateKeyAccount {
    return this.wallet.account;
  }

  public get address(): Address {
    return this.wallet.account.address;
  }

  public get anvilForkBlock(): bigint {
    const n = this.#anvilInfo?.forkConfig.forkBlockNumber;
    if (!n) {
      throw new Error("cannot get anvil fork block");
    }
    return BigInt(n);
  }
}
