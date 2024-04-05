import type { CreditAccountData } from "@gearbox-protocol/sdk";
import { CreditManagerData, tokenSymbolByAddress } from "@gearbox-protocol/sdk";
import type {
  BigNumber,
  BigNumberish,
  ContractTransaction,
  Wallet,
} from "ethers";

import { accountName, managerName } from "../utils";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3";
import type { ILiquidator } from "./generated";
import { ILiquidator__factory } from "./generated";
import type {
  ILiquidationStrategy,
  PartialLiquidationPreview,
  StrategyOptions,
} from "./types";

export default class LiquidationStrategyV3Partial
  extends AbstractLiquidationStrategyV3
  implements ILiquidationStrategy<PartialLiquidationPreview>
{
  public readonly name = "partial";
  public readonly adverb = "partially";

  readonly #partialLiquidatorAddress: string;
  #partialLiquidator?: ILiquidator;

  constructor(partialLiquidatorAddress: string) {
    super();
    this.#partialLiquidatorAddress = partialLiquidatorAddress;
  }

  public async launch(options: StrategyOptions): Promise<void> {
    await super.launch(options);
    this.#partialLiquidator = ILiquidator__factory.connect(
      this.#partialLiquidatorAddress,
      options.provider,
    );
  }

  public async preview(
    ca: CreditAccountData,
    slippage: number,
  ): Promise<PartialLiquidationPreview> {
    const logger = this.logger.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: managerName(ca),
    });
    const cm = new CreditManagerData(
      await this.compressor.getCreditManagerData(ca.creditManager),
    );
    // sort by liquidation threshold ASC, place underlying with lowest priority
    const balances = Object.entries(ca.allBalances)
      .map(
        ([t, b]) => [t, b.balance, cm.liquidationThresholds[t] ?? 0n] as const,
      )
      .sort((a, b) => {
        if (a[0] === ca.underlyingToken) return 1;
        if (b[0] === ca.underlyingToken) return -1;
        return Number(a[2]) - Number(b[2]);
      });

    const connectors = this.pathFinder.getAvailableConnectors(
      Object.fromEntries(balances),
    );

    // TODO: maybe this should be refreshed every loop iteration
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(ca);
    for (const [assetOut, balance] of balances) {
      const symb = tokenSymbolByAddress[assetOut.toLowerCase()];
      // naively try to figure out amount that works
      for (let i = 1n; i <= 10n; i++) {
        const amountOut = (i * balance) / 10n;
        logger.debug(`trying partial liqudation: ${i * 10n}% of ${symb} out`);
        const result =
          await this.partialLiquidator.callStatic.previewPartialLiquidation(
            cm.address,
            ca.addr,
            assetOut,
            amountOut,
            priceUpdates,
            connectors,
            slippage,
          );
        if (result.calls.length) {
          logger.info(
            `preview of partial liquidation: ${i * 10n}% of ${symb} succeeded with profit ${result.profit.toString()}`,
          );
          return {
            amountOut,
            assetOut,
            calls: result.calls,
            underlyingBalance: 0n, // TODO: calculate
          };
        }
      }
    }

    throw new Error(
      `cannot find token and amount for successfull partial liquidation of ${accountName(ca)}`,
    );
  }

  public async estimate(
    executor: Wallet,
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    recipient: string,
  ): Promise<BigNumber> {
    // TODO: recipient?
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(account);
    const partialLiquidator = this.partialLiquidator.connect(executor);
    return partialLiquidator.estimateGas.partialLiquidateAndConvert(
      account.creditManager,
      account.addr,
      preview.assetOut,
      preview.amountOut,
      priceUpdates,
      preview.calls,
    );
  }

  public async liquidate(
    executor: Wallet,
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    recipient: string,
    gasLimit?: BigNumberish,
  ): Promise<ContractTransaction> {
    // TODO: recipient
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(account);
    const partialLiquidator = this.partialLiquidator.connect(executor);
    return partialLiquidator.partialLiquidateAndConvert(
      account.creditManager,
      account.addr,
      preview.assetOut,
      preview.amountOut,
      priceUpdates,
      preview.calls,
      gasLimit ? { gasLimit } : {},
    );
  }

  private get partialLiquidator(): ILiquidator {
    if (!this.#partialLiquidator) {
      throw new Error("strategy not launched");
    }
    return this.partialLiquidator;
  }
}
