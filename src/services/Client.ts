import { nextTick } from "node:process";
import type { INotificationService } from "@gearbox-protocol/cli-utils";
import { chains, formatBN, PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk";
import type {
  AnvilClient,
  AnvilNodeInfo,
  RevolverTransportValue,
} from "@gearbox-protocol/sdk/dev";
import { createAnvilClient } from "@gearbox-protocol/sdk/dev";
import type { Abi } from "abitype";
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
  TransactionReceipt,
  Transport,
  WalletClient,
} from "viem";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  http,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { errorAbis } from "../errors/abis.js";
import { TransactionRevertedError } from "../errors/TransactionRevertedError.js";
import { type ILogger, Logger } from "../log/index.js";
import type { StatusCode } from "../utils/index.js";
import { LowBalanceNotification } from "./notifier/index.js";

const GAS_X = 5000n;

@DI.Injectable(DI.Client)
export default class Client {
  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Notifier)
  notifier!: INotificationService;

  @DI.Inject(DI.Transport)
  transport!: Transport<"revolver", RevolverTransportValue>;

  @Logger("Client")
  public logger!: ILogger;

  #anvilInfo: AnvilNodeInfo | null = null;

  #publicClient?: PublicClient;

  #walletClient?: WalletClient<Transport, Chain, PrivateKeyAccount, undefined>;

  #testClient?: AnvilClient;

  #balance?: { value: bigint; status: StatusCode };

  #gasFees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};

  public async launch(): Promise<void> {
    const { chainId, network, optimistic, privateKey, pollingInterval } =
      this.config;
    const chain = defineChain({
      ...chains[network],
      id: chainId,
    });

    this.#publicClient = createPublicClient({
      cacheTime: 0,
      chain,
      transport: this.transport,
      pollingInterval: optimistic ? 25 : pollingInterval,
    });
    this.#walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey.value),
      chain,
      transport: this.transport,
      pollingInterval: optimistic ? 25 : undefined,
    });
    try {
      const url = this.config.jsonRpcProviders?.[0]?.value;
      if (url) {
        this.#testClient = createAnvilClient({
          transport: http(url, {
            timeout: 240_000,
            retryCount: 10,
            batch: false,
          }),
          chain,
          cacheTime: 0,
          pollingInterval: 25,
        });
        this.#anvilInfo = await this.#testClient.anvilNodeInfo();
      }
    } catch {}
    if (this.#anvilInfo) {
      this.logger.debug(`running on anvil, fork block: ${this.anvilForkBlock}`);
    } else {
      this.logger.debug("running on real rpc");
    }
    await this.#checkBalance();
    if (this.config.optimistic) {
      this.#gasFees = await this.pub.estimateFeesPerGas();
      this.logger.debug(this.#gasFees, "optimistic gas fees");
    }
  }

  public async liquidate(
    request: SimulateContractReturnType["request"],
  ): Promise<TransactionReceipt> {
    if (this.config.dryRun && !this.config.optimistic) {
      throw new Error("dry run mode");
    }
    this.logger.debug("sending liquidation tx");
    const { abi, address, args, dataSuffix, functionName, ...rest } = request;
    const data = encodeFunctionData({
      abi,
      args,
      functionName,
    } as EncodeFunctionDataParameters);
    const req = await this.wallet.prepareTransactionRequest({
      ...(this.#gasFees as any),
      ...rest,
      to: request.address,
      data,
    });
    const { gas, maxFeePerGas, maxPriorityFeePerGas } = req;
    if (maxPriorityFeePerGas && maxFeePerGas) {
      req.maxPriorityFeePerGas = 10n * maxPriorityFeePerGas;
      req.maxFeePerGas = 2n * maxFeePerGas + req.maxPriorityFeePerGas;
    }
    if (gas) {
      req.gas = (gas * (GAS_X + PERCENTAGE_FACTOR)) / PERCENTAGE_FACTOR;
    }
    const txCost = req.gas * req.maxFeePerGas + (req.value ?? 0n);
    this.logger.debug(
      {
        maxFeePerGas: req.maxFeePerGas,
        maxPriorityFeePerGas: req.maxPriorityFeePerGas,
        gas: req.gas,
        txCost,
      },
      `increase gas fees`,
    );

    if (this.#balance && txCost > this.#balance.value) {
      this.logger.warn(
        {
          txCost,
          balance: this.#balance.value,
        },
        `transaction cost ${formatBN(txCost, 18)} exceeds balance (${formatBN(this.#balance.value, 18)} ETH)`,
      );
    }

    const serializedTransaction = await this.wallet.signTransaction(req);
    const hash = await this.wallet.sendRawTransaction({
      serializedTransaction,
    });
    const { data: _data, to, value, account, ...params } = req;
    this.logger.debug({ hash, ...params }, "sent transaction");
    const receipt = await this.#waitForTransactionReceipt(hash);
    this.logger.debug({ hash, status: receipt.status }, "received receipt");
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
      abi: [...args.abi, ...errorAbis],
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
    this.#balance = {
      value: balance,
      status:
        !this.config.minBalance || balance >= this.config.minBalance
          ? "healthy"
          : "alert",
    };
    this.logger.debug(`liquidator balance is ${formatEther(balance)}`);
    if (balance < this.config.minBalance) {
      this.notifier.alert(
        new LowBalanceNotification(
          this.config.network,
          this.address,
          balance,
          this.config.minBalance,
        ),
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

  public get anvil(): AnvilClient {
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

  public get balance(): { value: bigint; status: StatusCode } | undefined {
    return this.#balance;
  }

  public get anvilForkBlock(): bigint {
    const n = this.#anvilInfo?.forkConfig.forkBlockNumber;
    if (!n) {
      throw new Error("cannot get anvil fork block");
    }
    return BigInt(n);
  }
}
