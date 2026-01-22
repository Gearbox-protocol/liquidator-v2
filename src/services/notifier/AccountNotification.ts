import {
  type CreditAccountData,
  etherscanUrl,
  type GearboxSDK,
  hexEq,
  PERCENTAGE_FACTOR,
  SDKConstruct,
  WAD,
} from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address, TransactionReceipt } from "viem";

export default abstract class AccountNotification extends SDKConstruct {
  protected readonly ca: CreditAccountData;
  public readonly receipt?: TransactionReceipt;

  constructor(
    sdk: GearboxSDK,
    ca: CreditAccountData,
    receipt?: TransactionReceipt,
  ) {
    super(sdk);
    this.ca = ca;
    this.receipt = receipt;
  }

  protected forMarketConfigurator(mc?: Address): boolean {
    if (!mc) {
      return true;
    }

    const creditManager = this.sdk.marketRegister.findCreditManager(
      this.ca.creditManager,
    );
    return hexEq(mc, creditManager.marketConfigurator);
  }

  protected get caPlain(): string {
    return etherscanUrl(this.ca, this.networkType);
  }

  protected get caMd(): Markdown {
    return md.link(this.ca?.creditAccount, this.caPlain);
  }

  protected get cmPlain(): string {
    return etherscanUrl({ address: this.ca.creditManager }, this.networkType);
  }

  protected get cmMd(): Markdown {
    return md.link(this.ca.creditManager, this.cmPlain);
  }

  protected get withHF(): string {
    const hfStr = (
      Number((this.ca.healthFactor * PERCENTAGE_FACTOR) / WAD) / 100_00
    ).toString(10);
    return `with HF ${hfStr}`;
  }
}
