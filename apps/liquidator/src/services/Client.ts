import { nextTick } from "node:process";
import type { INotificationService } from "@gearbox-protocol/cli-utils";
import type { Config } from "@gearbox-protocol/liquidator-v2-config";
import { chains, formatBN, PERCENTAGE_FACTOR } from "@gearbox-protocol/sdk";
import type {
  AnvilClient,
  AnvilNodeInfo,
  RevolverTransportValue,
} from "@gearbox-protocol/sdk/dev";
import { createAnvilClient } from "@gearbox-protocol/sdk/dev";
import type { Abi } from "abitype";
import type {
  Account,
  Address,
  Chain,
  ContractFunctionArgs,
  ContractFunctionName,
  Hex,
  LocalAccount,
  PublicClient,
  SimulateContractParameters,
  TransactionReceipt,
  Transport,
  WalletClient,
} from "viem";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  WaitForTransactionReceiptTimeoutError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DI } from "../di.js";
import { errorAbis } from "../errors/abis.js";
import { TransactionRevertedError } from "../errors/TransactionRevertedError.js";
import { type ILogger, Logger } from "../log/index.js";
import type { StatusCode } from "../utils/index.js";
import type { LiquidationRequest } from "./liquidate/types.js";
import { LowBalanceNotification } from "./notifier/index.js";

const GAS_X = 5000n;

// Multipliers used to inflate the estimated gas price so that transactions
// are mined quickly. Kept in one place so that the balance check and the
// liquidation flow agree on what "current gas price" means.
const MAX_FEE_MULTIPLIER = 2n;
const PRIORITY_FEE_MULTIPLIER = 10n;

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

  #walletClient?: WalletClient<Transport, Chain, Account, undefined>;

  #testClient?: AnvilClient;

  #balance?: { value: bigint; status: StatusCode };

  #gasFees: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } = {};

  public async launch(): Promise<void> {
    const { chainId, network, optimistic, pollingInterval } = this.config;
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
    this.#walletClient = createWalletClient({
      account: await this.#resolveAccount(),
      chain,
      transport: this.transport,
      pollingInterval: optimistic ? 25 : undefined,
    });
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

  async #resolveAccount(): Promise<Account> {
    const { optimistic, privateKey, liquidatorAddress } = this.config;
    if (!optimistic) {
      // production path
      if (!privateKey) {
        throw new Error("PRIVATE_KEY is required in non-optimistic mode");
      }
      if (liquidatorAddress) {
        throw new Error(
          "LIQUIDATOR_ADDRESS is only allowed in optimistic mode",
        );
      }
      const account = privateKeyToAccount(privateKey.value);
      this.logger.info(
        `production mode: using local account ${account.address} derived from private key`,
      );
      return account;
    }
    // optimistic path
    if (privateKey) {
      throw new Error(
        "PRIVATE_KEY must not be set in optimistic mode, use LIQUIDATOR_ADDRESS to choose the sender",
      );
    }
    if (!liquidatorAddress) {
      throw new Error("LIQUIDATOR_ADDRESS is required in optimistic mode");
    }
    if (!this.#testClient || !this.#anvilInfo) {
      throw new Error(
        "optimistic mode requires anvil as first json rpc provider",
      );
    }
    // impersonate once for the whole run; strategies only ever
    // stop-impersonating borrower addresses, so no conflict.
    // Funding this address on the fork is the anvil runner's job, not ours
    await this.#testClient.impersonateAccount({ address: liquidatorAddress });
    this.logger.info(
      `optimistic mode: impersonating ${liquidatorAddress} as liquidator`,
    );
    return { address: liquidatorAddress, type: "json-rpc" };
  }

  /**
   * Sends the liquidation transaction or a transaction it depends on (e.g. an
   * ERC-20 approval), inflating gas fees so that it does not stall the run.
   * @param request
   */
  public async sendTx(
    request: LiquidationRequest,
  ): Promise<TransactionReceipt> {
    if (this.config.dryRun && !this.config.optimistic) {
      throw new Error("dry run mode");
    }
    return this.#send(request);
  }

  async #send(request: LiquidationRequest): Promise<TransactionReceipt> {
    const req = await this.wallet.prepareTransactionRequest({
      ...this.#gasFees,
      ...request,
    } as Parameters<typeof this.wallet.prepareTransactionRequest>[0]);
    const { gas, maxFeePerGas, maxPriorityFeePerGas } = req;
    if (maxPriorityFeePerGas && maxFeePerGas) {
      req.maxPriorityFeePerGas = PRIORITY_FEE_MULTIPLIER * maxPriorityFeePerGas;
      req.maxFeePerGas =
        MAX_FEE_MULTIPLIER * maxFeePerGas + req.maxPriorityFeePerGas;
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

    let hash: Hex;
    if (this.account.type === "json-rpc") {
      // optimistic only: anvil accepts unsigned txs from impersonated senders
      this.logger.debug(
        "sending unsigned transaction from impersonated account",
      );
      hash = await this.wallet.sendTransaction(req);
    } else {
      // production path: sign locally and send raw transaction
      this.logger.debug(
        "signing and sending raw transaction with local account",
      );
      const wallet = this.wallet as WalletClient<
        Transport,
        Chain,
        LocalAccount,
        undefined
      >;
      const serializedTransaction = await wallet.signTransaction(req);
      hash = await wallet.sendRawTransaction({
        serializedTransaction,
      });
    }
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
    const hash = await this.wallet.writeContract(
      request as Parameters<typeof this.wallet.writeContract>[0],
    );
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
        } catch (e) {
          error = e instanceof Error ? e : new Error(String(e));
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

  /**
   * Returns the inflated gas price (wei per gas) used to size transactions.
   * Mirrors the inflation applied in `#send()` so the balance check and
   * the actual transaction cost agree on the gas price.
   */
  async #effectiveGasPrice(): Promise<bigint> {
    const { maxFeePerGas, maxPriorityFeePerGas } =
      await this.pub.estimateFeesPerGas();
    if (maxFeePerGas && maxPriorityFeePerGas) {
      return (
        MAX_FEE_MULTIPLIER * maxFeePerGas +
        PRIORITY_FEE_MULTIPLIER * maxPriorityFeePerGas
      );
    }
    // legacy / non EIP-1559 chains
    return this.pub.getGasPrice();
  }

  async #checkBalance(): Promise<void> {
    const balance = await this.pub.getBalance({ address: this.address });
    const gasPrice = await this.#effectiveGasPrice();
    const { minBalanceGas } = this.config;
    const minBalance = minBalanceGas * gasPrice;
    this.#balance = {
      value: balance,
      status: balance >= minBalance ? "healthy" : "alert",
    };
    this.logger.debug(
      {
        balance: formatEther(balance),
        minBalance: formatEther(minBalance),
        minBalanceGas,
        gasPrice,
      },
      `liquidator balance is ${formatEther(balance)}`,
    );
    if (balance < minBalance) {
      this.notifier.alert(
        new LowBalanceNotification(
          this.config.network,
          this.address,
          balance,
          minBalance,
          minBalanceGas,
          gasPrice,
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

  public get wallet(): WalletClient<Transport, Chain, Account, undefined> {
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

  public get account(): Account {
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
