import {
  RetryProvider,
  RotateProvider,
} from "@gearbox-protocol/devops/lib/providers";
import { formatBN, WAD } from "@gearbox-protocol/sdk";
import { Mutex } from "async-mutex";
import { BigNumber, providers, Wallet } from "ethers";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";
import { AMPQService } from "./ampqService";
import { IWalletStorage, WALLET_STORAGE } from "./wallet-storage";

@Service()
export class KeyService {
  @Logger("KeyService")
  log: LoggerInterface;

  @Inject()
  ampqService: AMPQService;

  @Inject(WALLET_STORAGE)
  storage: IWalletStorage;

  static readonly minExecutorBalance = WAD.div(2);

  signer: Wallet;
  protected provider: providers.Provider;
  protected _executors: Array<Wallet> = [];
  protected _isUsed: Record<string, boolean> = {};
  protected _mutex: Mutex = new Mutex();

  protected minBalanceToNotify: BigNumber;

  get address(): string {
    return this.signer.address;
  }

  /**
   * Launches KeyService
   * @param provider Ethers JSON RPC provider
   */
  async launch() {
    const rpcs = [
      new RetryProvider({
        url: config.ethProviderRpc,
        timeout: config.ethProviderTimeout,
        allowGzip: true,
      }),
    ];
    if (config.fallbackRpc) {
      rpcs.push(
        new RetryProvider({
          url: config.fallbackRpc,
          timeout: config.ethProviderTimeout,
          allowGzip: true,
        }),
      );
    }
    if (config.flashbotsRpc) {
      rpcs.unshift(
        new RetryProvider({
          url: config.flashbotsRpc,
          timeout: config.ethProviderTimeout,
          allowGzip: true,
        }),
      );
    }

    this.provider = new RotateProvider(rpcs, undefined, this.log);
    this.signer = new Wallet(config.privateKey, this.provider);
    this.minBalanceToNotify = WAD.mul(
      Math.floor(config.balanceToNotify * 1000),
    ).div(10000);

    await this.checkBalance();
    await this.storage.launch();

    if (!config.optimisticLiquidations) {
      await this._recoverWallets();
      for (let ex of this._executors) {
        await this.returnExecutor(ex.address);
      }
    }
  }

  /**
   * @returns Quantity of job-free executors
   */
  vacantQty(): number {
    return Object.values(this._isUsed).filter(r => !r).length;
  }

  /**
   * Takes on vacant executor and marks it as used
   * @returns
   */
  takeVacantExecutor(): Wallet {
    for (let ex of this._executors) {
      if (!this._isUsed[ex.address]) {
        this._isUsed[ex.address] = true;
        return ex;
      }
    }

    throw new Error("All executors are used");
  }

  /**
   * Takes liquidator back, recharge it and mark as "vacant" for further use
   * @param address Executor address
   */
  async returnExecutor(address: string) {
    try {
      const balance = await this.provider.getBalance(address);

      if (balance.lt(KeyService.minExecutorBalance)) {
        this.log.info("recharging ", address);
        await this._mutex.runExclusive(async () => {
          try {
            const receipt = await this.signer.sendTransaction({
              to: address,
              value: KeyService.minExecutorBalance,
              gasLimit: 42000,
            });
            await receipt.wait();
          } catch (e) {
            this.ampqService.error(`Cant recharge account ${address}\n${e}`);
          }
        });
      } else {
        this.log.info(`account ${address} has enough balance`);
      }

      this._isUsed[address] = false;
    } catch (e) {
      this.ampqService.error(`Cant get balance for ${address}\n${e}`);
    }
  }

  /**
   * Gets all executors addresses
   */
  getExecutorAddress(): Array<string> {
    return this._executors.map(e => e.address);
  }

  protected async _recoverWallets() {
    if (this._executors.length > 0)
      throw new Error("Executors are already exists");

    for (let i = 0; i < config.executorsQty; i++) {
      const walletKey = await this.storage.getOrCreateKey(i);
      const wallet = walletKey.connect(this.provider);
      this._executors.push(wallet);
    }
  }

  protected async checkBalance() {
    const balance = await this.signer.getBalance();
    this.log.info(
      `Wallet balance for ${this.signer.address} is: ${balance.toString()}`,
    );
    if (balance.lte(this.minBalanceToNotify)) {
      this.ampqService.error(
        `WARNING: Low wallet balance: ${formatBN(balance, 18)}`,
      );
    }
  }
}
