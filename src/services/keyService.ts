import { formatBN, WAD } from "@gearbox-protocol/sdk";
import { Mutex } from "async-mutex";
import { BigNumber, ContractTransaction, providers, Wallet } from "ethers";
import fs from "fs";
import { Inject, Service } from "typedi";
import config from "../config";
import { Logger, LoggerInterface } from "../decorators/logger";
import { AMPQService } from "./ampqService";

@Service()
export class KeyService {
  @Logger("KeyService")
  log: LoggerInterface;

  @Inject()
  ampqService: AMPQService;

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
  async launch(provider: providers.Provider) {
    this.provider = provider;
    this.signer = new Wallet(config.privateKey, this.provider);
    this.minBalanceToNotify = WAD.mul(
      Math.floor(config.balanceToNotify * 1000)
    ).div(10000);

    await this.checkBalance();

    // Gets wallets from disk or creates new ones
    await this._recoverFromFS();
    for (let ex of this._executors) {
      await this.returnExecutor(ex.address);
    }
  }

  /**
   * @returns Quantity of job-free executors
   */
  vacantQty(): number {
    return Object.values(this._isUsed).filter((r) => !r).length;
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
    return this._executors.map((e) => e.address);
  }

  protected async _recoverFromFS() {
    if (this._executors.length > 0)
      throw new Error("Executors are already exists");

    const keyExists = fs.existsSync(config.keyPath);

    try {
      if (!keyExists) {
        fs.mkdirSync(config.keyPath);
      }
    } catch (e) {
      this.ampqService.error(
        `Cant create directory ${config.keyPath} to store keys`
      );
    }

    for (let i = 0; i < config.executorsQty; i++) {
      const walletKey = await this._getOrCreateKey(i);
      const wallet = walletKey.connect(this.provider);

      this._executors.push(wallet);
    }
  }

  /**
   * Gets wallet from disc or creates it if not exists with provided password
   * @param num Stored key on disk
   * @return promise to wallet
   */
  protected async _getOrCreateKey(num: number): Promise<Wallet> {
    const fileName = `${config.keyPath}${num}.json`;
    const keyExists = fs.existsSync(fileName);
    if (keyExists) {
      try {
        const encryptedWallet = await fs.promises.readFile(fileName);
        return await Wallet.fromEncryptedJson(
          encryptedWallet.toString(),
          config.walletPassword
        );
      } catch (e) {
        this.ampqService.error(`Cant get key from file: ${fileName} ${e}`);
        process.exit(1);
      }
    }

    const newWallet = Wallet.createRandom();
    const encryptedWallet = await newWallet.encrypt(config.walletPassword);
    await fs.promises.writeFile(fileName, encryptedWallet);
    return newWallet;
  }

  protected async checkBalance() {
    const balance = await this.signer.getBalance();
    this.log.info(
      `Wallet balance for ${this.signer.address} is: ${balance.toString()}`
    );
    if (balance.lte(this.minBalanceToNotify)) {
      this.ampqService.error(
        `WARNING: Low wallet balance: ${formatBN(balance, 18)}`
      );
    }
  }
}
