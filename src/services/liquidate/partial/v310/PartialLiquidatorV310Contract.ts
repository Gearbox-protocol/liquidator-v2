import { iPartialLiquidatorAbi } from "@gearbox-protocol/liquidator-contracts/abi";
import type {
  CreditAccountData,
  CreditSuite,
  Curator,
  OnDemandPriceUpdates,
  PriceUpdateV310,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, hexEq } from "@gearbox-protocol/sdk";
import { errorAbis } from "@gearbox-protocol/sdk/abi/errors";
import { Create2Deployer } from "@gearbox-protocol/sdk/dev";
import {
  type Address,
  type Chain,
  encodeAbiParameters,
  type Hex,
  type PrivateKeyAccount,
  parseAbi,
  type SimulateContractReturnType,
  type Transport,
} from "viem";
import type { PartialLiquidationPreview } from "../../types.js";
import { AbstractPartialLiquidatorContract } from "../AbstractPartialLiquidatorContract.js";
import type {
  OptimalPartialLiquidation,
  RawPartialLiquidationPreview,
} from "../types.js";
import { humanizePreviewPartialLiquidation } from "../utils.js";

export default abstract class PartialLiquidatorV310Contract extends AbstractPartialLiquidatorContract {
  protected readonly deployer: Create2Deployer<
    Transport,
    Chain,
    PrivateKeyAccount
  >;
  #setupComplete = false;

  constructor(name: string, router: Address, curator: Curator) {
    super(name, 310, router, curator);
    this.deployer = new Create2Deployer(this.sdk, this.client.wallet);
  }

  public override queueCreditManagerRegistration(cm: CreditSuite): void {
    // For v310, credit managers are registered automatically, unless they have degen NFT
    if (cm.creditFacade.degenNFT === ADDRESS_0X0) {
      return;
    }
    super.queueCreditManagerRegistration(cm);
  }

  /**
   * Registers router, partial liquidation bot and credit manager addresses in liquidator contract if necessary
   */
  protected override async configure(): Promise<void> {
    // call this only once at startup
    // in theory, sdk router (which is passed as constructor arg) can change during runtime
    // but it's very rare thing and it'll be breaking anyway, most likely
    if (!this.#setupComplete) {
      const currentRouter = await this.client.pub.readContract({
        abi: parseAbi(["function router() view returns (address)"]),
        address: this.address,
        functionName: "router",
      });

      if (!hexEq(currentRouter, this.router)) {
        this.logger.warn(
          `need to update router from ${currentRouter} to ${this.router}`,
        );
        await this.configureRouterAddress(this.router);
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
      abi: [...iPartialLiquidatorAbi, ...errorAbis],
      address: this.address,
      functionName: "getOptimalLiquidation",
      args: [
        ca.creditAccount,
        optimalHF,
        priceUpdates.raw as PriceUpdateV310[] as any,
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
    this.caLogger(ca).debug(
      humanizePreviewPartialLiquidation(
        cm,
        optimalLiquidation,
        priceUpdates,
        this.config.slippage,
        this.address,
      ),
      "calling previewPartialLiquidation",
    );
    const { result: preview } = await this.client.pub.simulateContract({
      account: ADDRESS_0X0,
      address: this.address,
      abi: [...iPartialLiquidatorAbi, ...errorAbis],
      functionName: "previewPartialLiquidation",
      args: [
        ca.creditManager,
        ca.creditAccount,
        optimalLiquidation.tokenOut,
        optimalLiquidation.optimalAmount,
        optimalLiquidation.flashLoanAmount,
        priceUpdates.raw as PriceUpdateV310[] as any,
        BigInt(this.config.slippage),
        4n, // TODO: splits
        this.extraData,
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
      abi: [...iPartialLiquidatorAbi, ...errorAbis],
      functionName: "partialLiquidateAndConvert",
      args: [
        account.creditManager,
        account.creditAccount,
        preview.assetOut,
        preview.amountOut,
        preview.flashLoanAmount,
        preview.priceUpdates as readonly PriceUpdateV310[],
        preview.calls,
        this.extraData,
      ],
    });
  }

  protected get partialLiquidationBot(): Address {
    if (this.config.liquidationMode === "deleverage") {
      return this.config.partialLiquidationBot;
    }
    throw new Error(
      "partial liquidation bot is only available in deleverage mode",
    );
  }

  protected get extraData(): Hex {
    return this.config.liquidationMode === "deleverage"
      ? encodeAbiParameters([{ type: "address" }], [this.partialLiquidationBot])
      : "0x0";
  }
}
