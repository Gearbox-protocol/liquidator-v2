import type {
  CreditAccountData,
  CreditSuite,
  Curator,
  ICreditAccountsService,
  OnchainSDK,
  PriceUpdate,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, AddressMap } from "@gearbox-protocol/sdk";
import type { Address, SimulateContractReturnType } from "viem";
import { parseAbi } from "viem";
import type {
  DeleverageLiquidatorSchema,
  LiqduiatorConfig,
  PartialLiquidatorSchema,
} from "../../../config/index.js";
import { DI } from "../../../di.js";
import type { ILogger } from "../../../log/index.js";
import type Client from "../../Client.js";
import type DeleverageService from "../../DeleverageService.js";
import type { PartialLiquidationPreview } from "../types.js";
import type {
  IPartialLiquidatorContract,
  OptimalPartialLiquidation,
  RawPartialLiquidationPreview,
} from "./types.js";

export abstract class AbstractPartialLiquidatorContract
  implements IPartialLiquidatorContract
{
  logger: ILogger;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<
    PartialLiquidatorSchema | DeleverageLiquidatorSchema
  >;

  @DI.Inject(DI.CreditAccountService)
  creditAccountService!: ICreditAccountsService;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.Deleverage)
  deleverage!: DeleverageService;

  #registeredCMs = new AddressMap<boolean>();
  #address?: Address;
  #router: Address;
  /**
   * Credit managers for which async write operations (register, etc.) are pending
   */
  #pendingCreditManagers: CreditSuite[] = [];

  public readonly name: string;
  public readonly curator: Curator;
  public readonly version: number;

  constructor(
    name: string,
    version: number,
    router: Address,
    curator: Curator,
  ) {
    this.name = `${name} ${curator} V${version}`;
    this.curator = curator;
    this.version = version;
    this.#router = router;
    this.logger = DI.create(DI.Logger, this.name.replaceAll(" ", ""));
  }

  public queueCreditManagerRegistration(cm: CreditSuite): void {
    this.#pendingCreditManagers.push(cm);
    this.logger.debug(
      `queued credit manager ${cm.creditManager.name} (${cm.creditManager.address})`,
    );
  }

  public async syncState(): Promise<void> {
    if (!this.isDeployed) {
      await this.deploy();
    }
    await this.configure();
  }

  /**
   * Registers credit manager addresses in liquidator contract if necessary
   * Can be called multiple times, each time processes pending credit managers
   */
  protected async configure(): Promise<void> {
    if (this.#pendingCreditManagers.length === 0) {
      return;
    }
    const creditAccounts = await this.#getLiquidatorAccounts();

    for (const cm of this.#pendingCreditManagers) {
      const { address, name } = cm.creditManager;
      const ca = creditAccounts.get(address);
      if (ca === ADDRESS_0X0) {
        await this.#registerCM(cm);
      } else {
        this.logger.debug(
          `credit manager ${name} (${address}) already registered with account ${ca}`,
        );
        this.#registeredCMs.upsert(address, true);
      }
    }

    this.logger.debug(
      `configured ${this.#pendingCreditManagers.length} credit managers`,
    );
    this.#pendingCreditManagers = [];
  }

  protected async configureRouterAddress(router: Address): Promise<void> {
    const receipt = await this.client.simulateAndWrite({
      abi: parseAbi(["function setRouter(address newRouter)"]),
      address: this.address,
      functionName: "setRouter",
      args: [router],
    });
    if (receipt.status === "reverted") {
      throw new Error(
        `PartialLiquidator.setRouter(${router}) tx ${receipt.transactionHash} reverted`,
      );
    }
    this.logger.info(
      `set router to ${router} in tx ${receipt.transactionHash}`,
    );
  }

  protected abstract deploy(): Promise<void>;

  /**
   * Returns mapping [Credit Manager Address] => [Address of Partialidator's CA in this CM]
   * @returns
   */
  async #getLiquidatorAccounts(): Promise<AddressMap<Address>> {
    const results = await this.client.pub.multicall({
      allowFailure: false,
      contracts: this.#pendingCreditManagers.map(cm => ({
        abi: parseAbi([
          "function cmToCA(address creditManager) view returns (address creditAccount)",
        ]),
        address: this.address,
        functionName: "cmToCA",
        args: [cm.creditManager.address],
      })),
    });
    this.logger.debug(`loaded ${results.length} liquidator credit accounts`);
    return new AddressMap(
      this.#pendingCreditManagers.map((cm, i) => [
        cm.creditManager.address,
        results[i],
      ]),
    );
  }

  async #registerCM(cm: CreditSuite): Promise<void> {
    const { address, name } = cm.creditManager;
    try {
      this.logger.debug(`need to register credit manager ${name} (${address})`);
      const receipt = await this.client.simulateAndWrite({
        abi: parseAbi(["function registerCM(address creditManager)"]),
        address: this.address,
        functionName: "registerCM",
        args: [address],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `Liquidator.registerCM(${address}) reverted: ${receipt.transactionHash}`,
        );
      }
      this.logger.info(
        `registered credit manager ${name} (${address}) in tx ${receipt.transactionHash}`,
      );
      this.#registeredCMs.upsert(address, true);
    } catch (e) {
      this.logger.error(
        `failed to register credit manager ${name} (${address}): ${e}`,
      );
      this.#registeredCMs.upsert(address, false);
    }
  }

  public abstract getOptimalLiquidation(
    ca: CreditAccountData,
    priceUpdates: PriceUpdate[],
  ): Promise<OptimalPartialLiquidation>;

  public abstract previewPartialLiquidation(
    ca: CreditAccountData,
    cm: CreditSuite,
    optimalLiquidation: OptimalPartialLiquidation,
    priceUpdates: PriceUpdate[],
  ): Promise<RawPartialLiquidationPreview>;

  public abstract partialLiquidateAndConvert(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType<unknown[], any, any>>;

  /**
   * Returns partial liquidation bot, or deleverage bot
   */
  protected abstract get partialLiquidationBot(): Address;

  public get envVariables(): Record<string, string> {
    return {};
  }

  /**
   * Returns HF that credit account should have after deleverage or partial liquidation
   * @param ca
   * @returns
   */
  protected getOptimalHealthFactor(ca: CreditAccountData): bigint {
    if (this.config.liquidationMode === "partial") {
      let hf = this.config.targetPartialHF;
      for (const t of this.config.calculatePartialHF ?? []) {
        if (ca.underlying === t) {
          hf = this.creditAccountService.getOptimalHFForPartialLiquidation(ca);
          break;
        }
      }
      this.caLogger(ca).debug(`optimal HF is ${hf}`);
      return hf;
    } else if (this.config.liquidationMode === "deleverage") {
      const minHealthFactor = BigInt(this.deleverage.bot.minHealthFactor);
      const maxHealthFactor = BigInt(this.deleverage.bot.maxHealthFactor);
      const optimalHF = maxHealthFactor - 100n;
      return optimalHF <= minHealthFactor
        ? (minHealthFactor + maxHealthFactor) / 2n
        : optimalHF;
    }
    throw new Error("invalid liquidation mode");
  }

  protected set address(value: Address) {
    this.#address = value;
    this.logger.info(`partial liquidator contract address: ${this.#address}`);
  }

  public get address(): Address {
    if (!this.#address) {
      throw new Error(`liquidator contract address not set for ${this.name}`);
    }
    return this.#address;
  }

  protected get isDeployed(): boolean {
    return !!this.#address;
  }

  protected get router(): Address {
    return this.#router;
  }

  protected get sdk(): OnchainSDK {
    return this.creditAccountService.sdk;
  }

  protected get owner(): Address {
    return this.client.wallet.account.address;
  }

  protected caLogger(ca: CreditAccountData): ILogger {
    const cm = this.sdk.marketRegister.findCreditManager(ca.creditManager);
    return this.logger.child({
      account: ca.creditAccount,
      borrower: ca.owner,
      manager: cm.name,
      hf: ca.healthFactor,
    });
  }
}
