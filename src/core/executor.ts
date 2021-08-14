import { Wallet } from "ethers";
import { ContractTransaction } from "@ethersproject/contracts";
import { WAD } from "@diesellabs/gearbox-sdk";

export type ExecutorJob = (
  wallet: Wallet
) => Promise<ContractTransaction | undefined>;
export type JobGetter = () => ExecutorJob | undefined;

export class Executor {
  static readonly minBalance = WAD.div(10);
  private readonly _address: string;
  protected _wallet: Wallet;
  private _isVacant: boolean;
  protected _recharge: (address: string) => Promise<void>;

  constructor(wallet: Wallet, recharge: (address: string) => Promise<void>) {
    this._wallet = wallet;
    this._address = wallet.address;
    this._isVacant = true;
    this._recharge = recharge;
  }

  async execute(
    jobGetter: JobGetter
  ): Promise<ContractTransaction | undefined> {
    this._isVacant = false;
    const job = jobGetter();
    if (!job) {
      this._isVacant = true;
      console.log("NO JOB")
      return;
    }

    console.log(`Executor #${this.address} starting job`)

    const balance = await this._wallet.getBalance();
    if (balance.lt(Executor.minBalance)) {
      await this._recharge(this._wallet.address);
    }

    const receipt = await job(this._wallet);
    await receipt?.wait();

    const newJob = jobGetter();
    if (newJob) {
      return await this.execute(jobGetter);
    }
    this._isVacant = true;

    return receipt;
  }

  get address(): string {
    return this._address;
  }

  get isVacant(): boolean {
    return this._isVacant;
  }
}
