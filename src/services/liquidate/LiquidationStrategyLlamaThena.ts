import {
  AddressSet,
  type CreditAccountData,
  type GearboxSDK,
  type ICreditAccountsService,
  PERCENTAGE_FACTOR,
} from "@gearbox-protocol/sdk";
import { Create2Deployer } from "@gearbox-protocol/sdk/dev";
import type { Address } from "@gearbox-protocol/types/optimist";
import type { Hex, SimulateContractReturnType } from "viem";
import { encodeFunctionData } from "viem";
import type {
  FullLiquidatorSchema,
  LiqduiatorConfig,
} from "../../config/index.js";
import { DI } from "../../di.js";
import { errorAbis } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import type Client from "../Client.js";
import AccountHelper from "./AccountHelper.js";
import LlamaThenaLiquidatorJson from "./legacy/LlamaThenaLiquidator.json" with {
  type: "json",
};
import { AAVE_V3_LENDING_POOL } from "./partial/constants.js";
import type {
  ILiquidationStrategy,
  LiquidationPreview,
  MakeLiquidatableResult,
} from "./types.js";

interface LlamaThenaLiquidationPreview extends LiquidationPreview {
  underlyingAmount: bigint;
  minUnderlyingBack: bigint;
}

const LLAMATHENA_TOKENS_MAINNET = new AddressSet([
  "0x72eD19788Bce2971A5ed6401662230ee57e254B7", // stkcvxllamathena
  "0x237926E55f9deee89833a42dEb92d3a6970850B4", // cvxllamathena
  "0xd29f8980852c2c76fC3f6E96a7Aa06E0BedCC1B1", // llamathena
  "0x9D39A5DE30e57443BfF2A8307A4256c8797A3497", // sUSDe
]);

export default class LiquidationStrategyLlamaThena
  extends AccountHelper
  implements ILiquidationStrategy<LlamaThenaLiquidationPreview>
{
  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: ICreditAccountsService;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<FullLiquidatorSchema>;

  @DI.Inject(DI.Client)
  client!: Client;

  @Logger("LlamaThenaStrategy")
  logger!: ILogger;

  public readonly name = "llamathena";

  #liquidator: Address | undefined;

  public async launch(): Promise<void> {
    const deployer = new Create2Deployer(this.sdk, this.client.wallet);
    const { address } = await deployer.ensureExists({
      abi: LlamaThenaLiquidatorJson.abi,
      bytecode: LlamaThenaLiquidatorJson.bytecode.object as Hex,
      args: [this.owner, AAVE_V3_LENDING_POOL.Mainnet],
    });
    this.#liquidator = address;
    this.logger.info(`LlamaThena legacy liquidator deployed at ${address}`);
  }

  public async syncState(_blockNumber: bigint): Promise<void> {}

  public isApplicable(ca: CreditAccountData): boolean {
    if (
      this.config.network !== "Mainnet" ||
      !this.config.llamathenaWorkaround
    ) {
      return false;
    }
    for (const { token, balance, mask } of ca.tokens) {
      const isEnabled = (mask & ca.enabledTokensMask) !== 0n;
      if (isEnabled && balance > 1n && LLAMATHENA_TOKENS_MAINNET.has(token)) {
        return true;
      }
    }
    return false;
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    return { account: ca };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<LlamaThenaLiquidationPreview> {
    const market = this.sdk.marketRegister.findByCreditManager(
      ca.creditManager,
    );
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    const underlying = cm.underlying;

    const underlyingValue = market.priceOracle.convertFromUSD(
      underlying,
      ca.totalValueUSD,
    );

    // underlyingAmount = underlyingValue * 9800 / PERCENTAGE_FACTOR (98%)
    const underlyingAmount = (underlyingValue * 9800n) / PERCENTAGE_FACTOR;
    // minUnderlyingBack = underlyingValue * 995 / 1000 (99.5%)
    const minUnderlyingBack = (underlyingValue * 995n) / 1000n;

    const callData = encodeFunctionData({
      abi: LlamaThenaLiquidatorJson.abi,
      functionName: "liquidateCreditAccount",
      args: [
        ca.creditManager,
        ca.creditAccount,
        underlyingAmount,
        minUnderlyingBack,
      ],
    });

    return {
      calls: [{ target: this.liquidator, callData }],
      underlyingBalance: 0n,
      underlyingAmount,
      minUnderlyingBack,
    };
  }

  public async simulate(
    account: CreditAccountData,
    preview: LlamaThenaLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>> {
    const result = await this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...LlamaThenaLiquidatorJson.abi, ...errorAbis],
      address: this.liquidator,
      functionName: "liquidateCreditAccount",
      args: [
        account.creditManager,
        account.creditAccount,
        preview.underlyingAmount,
        preview.minUnderlyingBack,
      ],
    });
    return result as unknown as SimulateContractReturnType<unknown[], any, any>;
  }

  private get liquidator(): Address {
    if (!this.#liquidator) {
      throw new Error("LlamaThena liquidator not deployed");
    }
    return this.#liquidator;
  }

  protected get sdk(): GearboxSDK {
    return this.creditAccountService.sdk;
  }

  protected get owner(): Address {
    return this.client.wallet.account.address;
  }
}
