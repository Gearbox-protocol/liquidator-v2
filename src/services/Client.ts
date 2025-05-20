import { nextTick } from "node:process";

import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import { PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk-gov";
import type { Abi } from "abitype";
import type {
  Address,
  Block,
  Chain,
  ContractFunctionArgs,
  ContractFunctionName,
  EncodeFunctionDataParameters,
  Hex,
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
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrum, base, mainnet, optimism, sonic } from "viem/chains";

import type { Config } from "../config/index.js";
import { exceptionsAbis } from "../data/index.js";
import { DI } from "../di.js";
import { TransactionRevertedError } from "../errors/TransactionRevertedError.js";
import { type ILogger, Logger } from "../log/index.js";
import type { INotifier } from "./notifier/index.js";
import { LowBalanceMessage } from "./notifier/index.js";

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
  {
    Method: "evm_mine_detailed";
    Parameters: [Hex];
    ReturnType: Block<Hex>[];
  },
];

const CHAINS: Record<NetworkType, Chain> = {
  Mainnet: mainnet,
  Arbitrum: arbitrum,
  Optimism: optimism,
  Base: base,
  Sonic: sonic,
};

@DI.Injectable(DI.Client)
export default class Client {
  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Notifier)
  notifier!: INotifier;

  @Logger("Client")
  public logger!: ILogger;

  #anvilInfo: AnvilNodeInfo | null = null;

  #publicClient?: PublicClient;
  #logsClient?: PublicClient;

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
    const { chainId, network, optimistic, privateKey } = this.config;
    const chain = defineChain({
      ...CHAINS[network],
      id: chainId,
    });

    this.#publicClient = createPublicClient({
      cacheTime: 0,
      chain,
      transport: this.#createTransport(),
      pollingInterval: optimistic ? 25 : undefined,
    });
    this.#logsClient = createPublicClient({
      cacheTime: 0,
      chain,
      transport: this.#createTransport(true),
      pollingInterval: optimistic ? 25 : undefined,
    });
    this.#walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey),
      chain,
      transport: this.#createTransport(),
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
        transport: this.#createTransport(),
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
    request: SimulateContractReturnType["request"],
    logger: ILogger,
  ): Promise<TransactionReceipt> {
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
    if (req.gas) {
      req.gas =
        (req.gas * (GAS_TIP_MULTIPLIER + PERCENTAGE_FACTOR)) /
        PERCENTAGE_FACTOR;
    }
    const serializedTransaction = await this.wallet.signTransaction(req);
    const hash = await this.wallet.sendRawTransaction({
      serializedTransaction,
    });
    const { data: _data, to, value, account, ...params } = req;
    logger.debug({ hash, ...params }, "sent transaction");
    const receipt = await this.#waitForTransactionReceipt(hash);
    logger.debug({ hash, status: receipt.status }, "received receipt");
    if (!this.config.optimistic) {
      nextTick(() => {
        this.#checkBalance().catch(() => {});
      });
    }
    return receipt;
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
    const account = args.account ?? this.account;
    const { request } = await this.pub.simulateContract<
      abi,
      functionName,
      args,
      undefined,
      Address
    >({
      ...args,
      abi: [...args.abi, ...exceptionsAbis],
      account,
    });
    const hash = await this.wallet.writeContract(request as any);
    return this.#waitForTransactionReceipt(hash);
  }

  async #waitForTransactionReceipt(
    hash: `0x${string}`,
  ): Promise<TransactionReceipt> {
    let receipt: TransactionReceipt | undefined;
    // sometimes on anvil, transactions gets stuck for unknown reasons
    if (this.#anvilInfo) {
      try {
        await this.anvil.mine({ blocks: 1 });
      } catch {}
      let error: Error | undefined;
      for (let i = 0; i < 3; i++) {
        try {
          receipt = await this.pub.waitForTransactionReceipt({
            hash,
            timeout: 12_000,
          });
        } catch (e: any) {
          error = e;
        }
      }
      if (error) {
        throw error;
      }
    } else {
      // non-anvil case
      receipt = await this.pub.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });
    }
    if (!receipt) {
      throw new WaitForTransactionReceiptTimeoutError({ hash });
    }
    if (receipt.status === "reverted") {
      throw new TransactionRevertedError(receipt);
    }
    return receipt;
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

  public get logs(): PublicClient {
    if (!this.#logsClient) {
      throw new Error("logs client not initialized");
    }
    return this.#logsClient;
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

  #createTransport(batch = false): Transport {
    const { ethProviderRpcs, optimistic } = this.config;
    const rpcs = ethProviderRpcs.map(url =>
      http(url, {
        timeout: optimistic ? 240_000 : 10_000,
        retryCount: optimistic ? 3 : undefined,
        batch,
      }),
    );
    return rpcs.length > 1 && !optimistic ? fallback(rpcs) : rpcs[0];
  }
}
