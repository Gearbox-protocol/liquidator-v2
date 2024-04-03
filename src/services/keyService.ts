import { formatBN } from "@gearbox-protocol/sdk";
import { Mutex } from "async-mutex";
import type { providers } from "ethers";
import { BigNumber, Wallet } from "ethers";
import { Inject, Service } from "typedi";

import config from "../config";
import { Logger, LoggerInterface } from "../log";
import { AMPQService } from "./ampqService";
import { getProvider } from "./utils";
import { IWalletStorage, WALLET_STORAGE } from "./wallet-storage";

@Service()
export class KeyService {
  @Logger("KeyService")
  log: LoggerInterface;

  @Inject()
  ampqService: AMPQService;

  @Inject(WALLET_STORAGE)
  storage: IWalletStorage;

  signer: Wallet;
  protected provider: providers.Provider;
  protected _executors: Array<Wallet> = [];
  protected _isUsed: Record<string, boolean> = {};
  protected _mutex: Mutex = new Mutex();

  get address(): string {
    return this.signer.address;
  }

  /**
   * Launches KeyService
   * @param provider Ethers JSON RPC provider
   */
  async launch() {
    this.provider = getProvider(true, this.log);
    this.signer = new Wallet(config.privateKey, this.provider);

    await this.checkBalance();
    await this.storage.launch();

    await this._recoverWallets();
    for (let ex of this._executors) {
      await this.returnExecutor(ex.address);
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
  async returnExecutor(address: string, recharge = true) {
    try {
      if (recharge) {
        const balance = await this.provider.getBalance(address);

        if (balance.lt(config.minExecutorBalance)) {
          this.log.info(
            `executor ${address} has insufficient balance: ${formatBN(balance, 18)}, recharging`,
          );
          await this._mutex.runExclusive(async () => {
            try {
              const receipt = await this.signer.sendTransaction({
                to: address,
                value: BigNumber.from(config.minExecutorBalance).sub(balance),
              });
              await receipt.wait();
              this.log.debug(`recharged executor ${address}`);
            } catch (e) {
              this.ampqService.error(`Cant recharge account ${address}\n${e}`);
            }
          });
        } else {
          this.log.info(
            `executor ${address} has sufficient balance: ${formatBN(balance, 18)}`,
          );
        }
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
      `wallet balance for ${this.signer.address} is: ${formatBN(balance, 18)}`,
    );
    if (balance.lte(config.balanceToNotify)) {
      this.ampqService.error(
        `WARNING: Low wallet ${this.signer.address} balance: ${formatBN(balance, 18)}`,
      );
    }
  }
}
