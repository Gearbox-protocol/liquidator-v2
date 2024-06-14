// import {
//   FlashbotsBundleProvider,
//   FlashbotsTransactionResolution,
// } from "@flashbots/ethers-provider-bundle";
import { nextTick } from "node:process";

import { PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk-gov";
import type { JsonRpcProvider, TransactionResponse } from "ethers";
import { formatUnits, Provider, Wallet } from "ethers";
import { Inject, Service } from "typedi";
import type {
  Address,
  Chain,
  CustomTransport,
  EncodeFunctionDataParameters,
  Hex,
  PrivateKeyAccount,
  SimulateContractReturnType,
  TransactionReceipt,
  Transport,
  WalletClient,
} from "viem";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { CONFIG, Config } from "../config/index.js";
import type { CreditAccountData } from "../data/index.js";
import { Logger, type LoggerInterface } from "../log/index.js";
import { PROVIDER, VIEM_PUBLIC_CLIENT } from "../utils/index.js";
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

@Service()
export default class ExecutorService {
  @Inject()
  public wallet: Wallet;

  @Inject(CONFIG)
  config: Config;

  @Inject(PROVIDER)
  public provider: Provider;

  @Inject(VIEM_PUBLIC_CLIENT)
  publicClient: PublicClient<Transport, Chain>;

  @Inject(NOTIFIER)
  notifier: INotifier;

  @Logger("ExecutorService")
  public logger: LoggerInterface;

  #anvilInfo: AnvilNodeInfo | null = null;

  #walletClient?: WalletClient<
    CustomTransport,
    Chain,
    PrivateKeyAccount,
    undefined
  >;

  // #flashbots?: FlashbotsBundleProvider;

  public async launch(): Promise<void> {
    let pk = this.config.privateKey as Hex;
    if (!pk.startsWith("0x")) {
      pk = `0x${pk}`;
    }
    this.#walletClient = createWalletClient({
      account: privateKeyToAccount(pk),
      chain: this.publicClient.chain,
      transport: custom(this.publicClient.transport),
    });
    try {
      const resp = await (this.provider as JsonRpcProvider).send(
        "anvil_nodeInfo",
        [],
      );
      this.#anvilInfo = resp;
    } catch {}
    if (this.#anvilInfo) {
      this.logger.debug("running on anvil");
    } else {
      this.logger.debug("running on real rpc");
    }
    await this.#checkBalance();
  }

  /**
   * Mines transaction on anvil. Because sometimes it gets stuck for unknown reasons,
   * add retries and timeout
   * @param tx
   * @returns
   */
  public async mine(tx: TransactionResponse): Promise<void> {
    if (this.#anvilInfo) {
      await (this.provider as JsonRpcProvider)
        .send("evm_mine", [])
        .catch(() => {});
    }

    await tx.wait(1, 12_000);
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
    const req = await this.walletClient.prepareTransactionRequest({
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
    const serializedTransaction = await this.walletClient.signTransaction(req);
    const hash = await this.walletClient.sendRawTransaction({
      serializedTransaction,
    });

    logger.debug(`sent transaction ${hash}`);
    const result = await this.publicClient.waitForTransactionReceipt({
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

  async #checkBalance(): Promise<void> {
    const balance = await this.provider.getBalance(this.wallet.address);
    this.logger.debug(`liquidator balance is ${formatUnits(balance, "ether")}`);
    if (balance < this.config.minBalance) {
      this.notifier.alert(
        new LowBalanceMessage(this.wallet, balance, this.config.minBalance),
      );
    }
  }

  // private async getFlashbots(): Promise<FlashbotsBundleProvider> {
  //   if (!config.flashbotsRpc) {
  //     throw new Error(`flashbots rpc not enabled`);
  //   }

  //   if (!this.#flashbots) {
  //     // TODO: set env variable
  //     // `authSigner` is an Ethereum private key that does NOT store funds and is NOT your bot's primary key.
  //     // This is an identifying key for signing payloads to establish reputation and whitelisting
  //     // In production, this should be used across multiple bundles to build relationship. In this example, we generate a new wallet each time
  //     const authSigner = Wallet.createRandom();

  //     this.#flashbots = await FlashbotsBundleProvider.create(
  //       this.provider,
  //       authSigner,
  //     );
  //   }

  //   return this.#flashbots;
  // }

  public get walletClient(): WalletClient<
    CustomTransport,
    Chain,
    PrivateKeyAccount,
    undefined
  > {
    if (!this.#walletClient) {
      throw new Error("wallet client not initialized");
    }
    return this.#walletClient;
  }

  public get address(): Address {
    return this.wallet.address as Address;
  }

  public get anvilForkBlock(): bigint {
    const n = this.#anvilInfo?.forkConfig.forkBlockNumber;
    if (!n) {
      throw new Error("cannot get anvil fork block");
    }
    return BigInt(n);
  }
}
