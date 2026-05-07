import { securitizeLiquidatorHelperAbi } from "@gearbox-protocol/liquidator-contracts/abi";
import type { CreditAccountData, OnchainSDK } from "@gearbox-protocol/sdk";
import { BaseError, type SimulateContractReturnType } from "viem";
import type {
  FullLiquidatorSchema,
  LiqduiatorConfig,
} from "../../config/index.js";
import { DI } from "../../di.js";
import { errorAbis } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import { RWAContractsDeployer } from "./rwa/RWAContractsDeployer.js";
import { resolveRedemptionGateway } from "./rwa/redemptionGateway.js";
import {
  type ILiquidationStrategy,
  type MakeLiquidatableResult,
  NotApplicableError,
  type RWALiquidationPreview,
} from "./types.js";

export default class LiquidationStrategyRWA
  extends AccountHelper
  implements ILiquidationStrategy<RWALiquidationPreview>
{
  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<FullLiquidatorSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("RWAStrategy")
  logger!: ILogger;

  #deployer: RWAContractsDeployer;

  constructor() {
    super();
    this.#deployer = new RWAContractsDeployer(this.sdk);
  }

  public get name(): string {
    return "rwa";
  }

  public async launch(): Promise<void> {
    await this.#deployer.syncState();
  }

  public async syncState(_blockNumber: bigint): Promise<void> {}

  public isApplicable(ca: CreditAccountData): boolean {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const meta = this.sdk.tokensMeta.mustGet(cm.underlying);
    return this.sdk.tokensMeta.isRWAUnderlying(meta);
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    return { account: ca };
  }

  public async preview(ca: CreditAccountData): Promise<RWALiquidationPreview> {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const redemptionGateway = resolveRedemptionGateway(this.sdk, cm.underlying);
    if (!redemptionGateway) {
      throw new Error(
        `cannot resolve redemption gateway for ${cm.underlying} in ${cm.name}`,
      );
    }
    const priceUpdates = await this.sdk.accounts.getOnDemandPriceUpdates(
      ca,
      !this.config.updateReservePrices,
    );
    try {
      const { result: canLiquidate } = await this.client.pub.simulateContract({
        account: this.client.account,
        abi: [...securitizeLiquidatorHelperAbi, ...errorAbis],
        address: this.#deployer.address,
        functionName: "canLiquidateViaStablecoins",
        args: [ca.creditAccount, redemptionGateway, priceUpdates],
      });
      if (!canLiquidate) {
        this.logger.info(
          `account ${ca.creditAccount} cannot be liquidated via stablecoins yet`,
        );
        throw new NotApplicableError(
          "account cannot be liquidated via stablecoins",
        );
      }
    } catch (e) {
      if (e instanceof NotApplicableError) {
        throw e;
      }
      throw new BaseError("cant preview rwa liquidation", {
        cause: e as Error,
      });
    }

    return {
      calls: [],
      underlyingBalance: 0n,
      redemptionGateway,
      priceUpdates,
      skipOnFailure: false,
    };
  }

  public async simulate(
    account: CreditAccountData,
    preview: RWALiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const result = await this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...securitizeLiquidatorHelperAbi, ...errorAbis],
      address: this.#deployer.address,
      functionName: "liquidateViaStablecoins",
      args: [
        account.creditAccount,
        preview.redemptionGateway,
        preview.priceUpdates,
      ],
    });
    return result as unknown as SimulateContractReturnType<unknown[], any, any>;
  }
}
