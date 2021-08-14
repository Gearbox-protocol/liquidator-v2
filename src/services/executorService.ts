import { Service } from "typedi";
import config from "../config";
import { Mutex } from "async-mutex";
import { providers, Wallet } from "ethers";
import fs from "fs";
import { Executor, ExecutorJob } from "../core/executor";
import { ContractTransaction } from "@ethersproject/contracts";
import { Logger, LoggerInterface } from "../decorators/logger";
import { WAD } from "@diesellabs/gearbox-sdk";

@Service()
export class ExecutorService {
  @Logger("ExecutorService")
  log: LoggerInterface;

  static readonly fullFillAmount = WAD.div(2);
  public static readonly executorsQty = 3;
  public static readonly path = "keys/";

  protected wallet: Wallet;

  protected _mutex: Mutex = new Mutex();
  protected _executors: Array<Executor>;
  protected _jobs: Array<ExecutorJob> = [];

  constructor() {
    this._mutex = new Mutex();
    this._jobs = [];
  }

  async launch(wallet: Wallet, provider: providers.JsonRpcProvider) {
    this.wallet = wallet;

    // Gets wallets from disk or creates new ones
    const wallets = await this._recoverFromFS();

    // connects wallets with provider
    this._executors = wallets.map((w) => {
      // creates new wallet connected with provider and creates executor
      return new Executor(w.connect(provider), (address) =>
        this._recharge(address)
      );
    });
  }

  getExecutorAddress(): Array<string> {
    return this._executors.map((e) => e.address);
  }

  async addToQueue(jobs: Array<ExecutorJob>) {
    this._jobs.push(...jobs);

    this.log.info(this._executors.length);

    const newExecPromises: Array<Promise<ContractTransaction | undefined>> =
      this._executors
        .filter((e) => e.isVacant)
        .map((e) => e.execute(() => this._jobGetter()));

    await Promise.all(newExecPromises);
  }

  protected async _recoverFromFS(): Promise<Array<Wallet>> {
    const keyExists = fs.existsSync(ExecutorService.path);
    if (!keyExists) {
      await fs.promises.mkdir(ExecutorService.path);
    }
    // const promises: Array<Promise<Wallet>> = [];
    const wallets: Array<Wallet> = [];
    for (let i = 0; i < ExecutorService.executorsQty; i++) {
      const wallet = await this._getOrCreateKey(i);
      wallets.push(wallet);
      // promises.push(this._getOrCreateKey(i));
    }
    return wallets;
    // return Promise.all(promises);
  }

  // @dev Gets wallet from disc or creates it if not exists with provided password
  // @return promise to wallet
  protected async _getOrCreateKey(num: number): Promise<Wallet> {
    const fileName = `${ExecutorService.path}${num}.json`;
    const keyExists = fs.existsSync(fileName);
    if (keyExists) {
      try {
        const encryptedWallet = await fs.promises.readFile(fileName);
        return await Wallet.fromEncryptedJson(
          encryptedWallet.toString(),
          config.walletPassword
        );
      } catch (e) {
        this.log.error("Cant get key from file: ", fileName);
        this.log.error(e);
        process.exit(1);
      }
    }

    const newWallet = Wallet.createRandom();
    const encryptedWallet = await newWallet.encrypt(config.walletPassword);
    await fs.promises.writeFile(fileName, encryptedWallet);
    return newWallet;
  }

  protected async _recharge(address: string) {
    this.log.info("recharging ", address);

    const startTime = Date.now();

    await this._mutex.runExclusive(async () => {
      try {
        const receipt = await this.wallet.sendTransaction({
          to: address,
          value: ExecutorService.fullFillAmount,
          gasLimit: 42000,
        });
        await receipt.wait();
      } catch (e) {
        this.log.error("cant recharge account ", address);
        this.log.error(e);
      }
    });

  }

  protected _jobGetter(): ExecutorJob | undefined {
    return this._jobs.pop();
  }
}
