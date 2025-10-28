import { iPartialLiquidatorAbi } from "@gearbox-protocol/liquidator-v2-contracts/abi";
import type {
  CreditAccountData,
  CreditSuite,
  Curator,
  OnDemandPriceUpdates,
  PriceUpdateV300,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, hexEq } from "@gearbox-protocol/sdk";
import type { Address, SimulateContractReturnType } from "viem";
import { parseAbi } from "viem";

import type { PartialV300ConfigSchema } from "../../../../config/index.js";
import { exceptionsAbis } from "../../../../data/index.js";
import type { PartialLiquidationPreview } from "../../types.js";
import { AbstractPartialLiquidatorContract } from "../AbstractPartialLiquidatorContract.js";
import type {
  OptimalPartialLiquidation,
  RawPartialLiquidationPreview,
} from "../types.js";
import { humanizePreviewPartialLiquidation } from "../utils.js";
import { V300_PARTIAL_LIQUIDATOR_BOTS } from "./constants.js";

export default abstract class PartialLiquidatorV300Contract extends AbstractPartialLiquidatorContract {
  #partialLiquidationBot: Address;
  protected readonly configAddress?: Address;
  #setupComplete = false;

  constructor(
    name: string,
    router: Address,
    curator: Curator,
    configAddress: keyof PartialV300ConfigSchema,
  ) {
    super(name, 300, router, curator);
    this.#partialLiquidationBot = V300_PARTIAL_LIQUIDATOR_BOTS[curator];
    if (this.config.liquidationMode === "partial") {
      this.configAddress = this.config[configAddress];
    }
  }

  protected async deploy(): Promise<void> {
    if (this.configAddress) {
      this.logger.debug(`found address in config: ${this.configAddress}`);
    }
  }

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  protected override async configure(): Promise<void> {
    // treat router address and bot address as immutable during runtime
    // so we need to check them only once at startup
    if (!this.#setupComplete) {
      const [currentRouter, currentBot] = await this.client.pub.multicall({
        contracts: [
          {
            // abi: iPartialLiquidatorAbi,
            abi: parseAbi(["function router() view returns (address)"]),
            address: this.address,
            functionName: "router",
          },
          {
            // abi: iPartialLiquidatorAbi,
            abi: parseAbi([
              "function partialLiquidationBot() view returns (address)",
            ]),
            address: this.address,
            functionName: "partialLiquidationBot",
          },
        ],
        allowFailure: false,
      });

      if (!hexEq(currentRouter, this.router)) {
        this.logger.warn(
          `need to update router from ${currentRouter} to ${this.router}`,
        );
        await this.configureRouterAddress(this.router);
      }

      if (!hexEq(this.partialLiquidationBot, currentBot)) {
        this.logger.warn(
          `need to update bot from ${currentBot} to ${this.partialLiquidationBot}`,
        );
        const receipt = await this.client.simulateAndWrite({
          abi: iPartialLiquidatorAbi,
          address: this.address,
          functionName: "setPartialLiquidationBot",
          args: [this.partialLiquidationBot],
        });
        if (receipt.status === "reverted") {
          throw new Error(
            `PartialLiquidator.setPartialLiquidationBot(${this.partialLiquidationBot}) tx ${receipt.transactionHash} reverted`,
          );
        }
        this.logger.info(
          `set bot to ${this.partialLiquidationBot} in tx ${receipt.transactionHash}`,
        );
      }
      this.#setupComplete = true;
    }

    await super.configure();
  }

  public async getOptimalLiquidation(
    ca: CreditAccountData,
    priceUpdates: OnDemandPriceUpdates,
  ): Promise<OptimalPartialLiquidation> {
    const optimalHF = this.getOptimalHealthFactor(ca);
    const {
      result: [
        tokenOut,
        optimalAmount,
        repaidAmount,
        flashLoanAmount,
        isOptimalRepayable,
      ],
    } = await this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      address: this.address,
      functionName: "getOptimalLiquidation",
      args: [
        ca.creditAccount,
        optimalHF,
        priceUpdates.raw as PriceUpdateV300[] as any,
      ],
      gas: 550_000_000n,
    });
    return {
      tokenOut,
      optimalAmount,
      repaidAmount,
      flashLoanAmount,
      isOptimalRepayable,
    };
  }

  public async previewPartialLiquidation(
    ca: CreditAccountData,
    cm: CreditSuite,
    optimalLiquidation: OptimalPartialLiquidation,
    priceUpdates: OnDemandPriceUpdates,
  ): Promise<RawPartialLiquidationPreview> {
    const connectors = this.sdk
      .routerFor(cm)
      .getAvailableConnectors(cm.creditManager.collateralTokens);

    this.caLogger(ca).debug(
      humanizePreviewPartialLiquidation(
        cm,
        optimalLiquidation,
        priceUpdates,
        this.config.slippage,
        this.address,
        connectors,
      ),
      "calling previewPartialLiquidation",
    );

    const { result: preview } = await this.client.pub.simulateContract({
      account: ADDRESS_0X0,
      address: this.address,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      functionName: "previewPartialLiquidation",
      args: [
        ca.creditManager,
        ca.creditAccount,
        optimalLiquidation.tokenOut,
        optimalLiquidation.optimalAmount,
        optimalLiquidation.flashLoanAmount,
        priceUpdates.raw as PriceUpdateV300[] as any,
        connectors,
        BigInt(this.config.slippage),
      ],
      gas: 550_000_000n,
    });

    return preview;
  }

  public async partialLiquidateAndConvert(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    return this.client.pub.simulateContract({
      account: this.client.account,
      address: this.address,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      functionName: "partialLiquidateAndConvert",
      args: [
        account.creditManager,
        account.creditAccount,
        preview.assetOut,
        preview.amountOut,
        preview.flashLoanAmount,
        preview.priceUpdates as readonly PriceUpdateV300[],
        preview.calls,
      ],
    });
  }

  protected get partialLiquidationBot(): Address {
    return this.#partialLiquidationBot;
  }
}
