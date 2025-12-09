import {
  type CreditAccountData,
  type MultiCall,
  PERCENTAGE_FACTOR,
  VERSION_RANGE_310,
} from "@gearbox-protocol/sdk";
import { iCreditFacadeMulticallV310Abi } from "@gearbox-protocol/sdk/abi/310/generated";
import { encodeFunctionData, parseEther } from "viem";
import type {
  DeleverageLiquidatorSchema,
  LiqduiatorConfig,
} from "../../config/index.js";
import { DI } from "../../di.js";
import { type ILogger, Logger } from "../../log/index.js";
import { DELEVERAGE_PERMISSIONS } from "../../utils/permissions.js";
import { PartialLiquidationBotV310Contract } from "../PartialLiquidationBotV310Contract.js";
import LiquidationStrategyPartial from "./LiquidationStrategyPartial.js";
import type {
  ILiquidationStrategy,
  MakeLiquidatableResult,
  PartialLiquidationPreview,
} from "./types.js";

export default class LiquidationStrategyDeleverage
  extends LiquidationStrategyPartial
  implements ILiquidationStrategy<PartialLiquidationPreview>
{
  @DI.Inject(DI.Config)
  // @ts-expect-error
  config!: LiqduiatorConfig<DeleverageLiquidatorSchema>;

  @Logger("DeleverageStrategy")
  // @ts-expect-error
  logger!: ILogger;

  public override isApplicable(ca: CreditAccountData): boolean {
    return this.checkAccountVersion(ca, VERSION_RANGE_310);
  }

  public override async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    if (!this.isApplicable(ca)) {
      throw new Error("warning: deleverage is not supported for v300 accounts");
    }
    const result = await super.makeLiquidatable(ca);
    const { creditFacade } = this.sdk.marketRegister.findCreditManager(
      ca.creditManager,
    );
    await this.client.anvil.impersonateAccount({ address: ca.owner });

    const addBotCall: MultiCall = {
      target: creditFacade.address,
      callData: encodeFunctionData({
        abi: iCreditFacadeMulticallV310Abi,
        functionName: "setBotPermissions",
        args: [this.config.partialLiquidationBot, DELEVERAGE_PERMISSIONS],
      }),
    };

    const tx = creditFacade.multicall(ca.creditAccount, [addBotCall]);

    await this.client.anvil.setBalance({
      address: ca.owner,
      value: parseEther("100"),
    });
    const hash = await this.client.anvil.sendTransaction({
      account: ca.owner,
      chain: this.client.anvil.chain,
      to: tx.to,
      data: tx.callData,
    });
    const receipt = await this.client.anvil.waitForTransactionReceipt({ hash });
    if (receipt.status === "reverted") {
      throw new Error(
        `failed to set bot permissions for account ${ca.creditAccount} in tx ${hash}: reverted`,
      );
    } else {
      this.logger.debug(
        `set bot permissions for account ${ca.creditAccount} in tx ${hash}`,
      );
    }
    await this.client.anvil.stopImpersonatingAccount({ address: ca.owner });

    return result;
  }

  protected override ignoreReservePrices(_ca: CreditAccountData): boolean {
    return false;
  }

  protected override optimisticHF(_ca: CreditAccountData): bigint {
    const minHF = PartialLiquidationBotV310Contract.get(
      this.sdk,
      this.config.partialLiquidationBot,
    ).minHealthFactor;
    return (minHF * 9990n) / PERCENTAGE_FACTOR;
  }
}
