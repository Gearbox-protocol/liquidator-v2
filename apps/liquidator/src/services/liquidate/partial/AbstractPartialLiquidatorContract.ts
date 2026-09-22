import type {
  DeleverageLiquidatorSchema,
  LiqduiatorConfig,
  PartialLiquidatorSchema,
  PartialStrategyPreview,
} from "@gearbox-protocol/liquidator-v2-config";
import {
  DEFAULT_MIDAS_ADMIN,
  greenlistMidasGateway,
} from "@gearbox-protocol/sdk/dev";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import type {
  CreditAccountData,
  CreditSuite,
  OnchainSDK,
  PriceUpdate,
} from "@gearbox-protocol/sdk/onchain";
import {
  ADDRESS_0X0,
  AddressMap,
  MidasDegenNFT,
  MidasIssuanceVaultAdapterContract,
} from "@gearbox-protocol/sdk/onchain";
import type { Address } from "viem";
import { isAddressEqual, parseAbi } from "viem";
import { DI } from "../../../di.js";
import type { ILogger } from "../../../log/index.js";
import type Client from "../../Client.js";
import type DeleverageService from "../../DeleverageService.js";
import type { LiquidationRequest } from "../types.js";
import type {
  IPartialLiquidatorContract,
  OptimalPartialLiquidation,
  RawPartialLiquidationPreview,
} from "./types.js";

const MGLOBAL_MTOKEN: Address = "0x7433806912Eae67919e66aea853d46Fa0aef98A8";

const abstractLiquidatorAbi = parseAbi([
  "function cmToCA(address creditManager) view returns (address creditAccount)",
]);

export abstract class AbstractPartialLiquidatorContract
  implements IPartialLiquidatorContract
{
  logger: ILogger;

  @DI.Inject(DI.Config)
  config!: LiqduiatorConfig<
    PartialLiquidatorSchema | DeleverageLiquidatorSchema
  >;

  @DI.Inject(DI.SDK)
  sdk!: OnchainSDK;

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
  public readonly curator: CuratorName;
  public readonly version: number;

  constructor(
    name: string,
    version: number,
    router: Address,
    curator: CuratorName,
  ) {
    this.name = `${name} ${curator} V${version}`;
    this.curator = curator;
    this.version = version;
    this.#router = router;
    this.logger = DI.create(DI.Logger, this.name.replaceAll(" ", ""));
  }

  public async queueCreditManagerRegistration(cm: CreditSuite): Promise<void> {
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
      const ca = creditAccounts.mustGet(address);
      if (ca === ADDRESS_0X0) {
        // liquidator contract must be greenlisted before it opens the conversion account
        await this.#workaroundMGLOBAL(cm, this.address);
        await this.#registerCM(cm);
      } else {
        this.logger.debug(
          `credit manager ${name} (${address}) already registered with account ${ca}`,
        );
        this.#registeredCMs.upsert(address, true);
      }
      // now greenlist conversion account for mGLOBAL
      await this.#workaroundMGLOBAL(cm);
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
      contracts: this.#pendingCreditManagers.map(cm =>
        this.#conversionAccount(cm.creditManager.address),
      ),
    });
    this.logger.debug(`loaded ${results.length} liquidator credit accounts`);
    return new AddressMap(
      this.#pendingCreditManagers.map((cm, i) => [
        cm.creditManager.address,
        results[i],
      ]),
    );
  }

  #conversionAccount(creditManager: Address) {
    return {
      abi: abstractLiquidatorAbi,
      address: this.address,
      functionName: "cmToCA",
      args: [creditManager],
    } as const;
  }

  async #registerCM(cm: CreditSuite): Promise<void> {
    const { address, name } = cm.creditManager;
    const openingCalls = await cm.openingCalls();
    try {
      this.logger.debug(
        `need to register credit manager ${name} (${address}) with ${openingCalls.length} opening calls`,
      );
      const receipt = await this.client.simulateAndWrite({
        abi: parseAbi([
          "function registerCM(address creditManager, (address target, bytes callData)[] openingCalls)",
        ]),
        address: this.address,
        functionName: "registerCM",
        args: [address, openingCalls],
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

  /**
   * TODO: TO BE REMOVED
   * Greenlists investor for mGLOBAL.
   *
   * @param investor Address to greenlist. Defaults to this liquidator's conversion account in `cm`.
   */
  async #workaroundMGLOBAL(cm: CreditSuite, investor?: Address): Promise<void> {
    if (!this.config.optimistic) {
      return;
    }
    const isMGlobal = cm.creditManager.adapters
      .values()
      .some(
        adapter =>
          adapter instanceof MidasIssuanceVaultAdapterContract &&
          isAddressEqual(adapter.mToken, MGLOBAL_MTOKEN),
      );
    if (!isMGlobal) {
      return;
    }
    const { address, name } = cm.creditManager;
    try {
      investor ??= await this.client.pub.readContract(
        this.#conversionAccount(address),
      );
      if (isAddressEqual(investor, ADDRESS_0X0)) {
        this.logger.debug(
          `no conversion account for ${name} (${address}), skipping mGLOBAL greenlist`,
        );
        return;
      }
      const nft = await cm.degenNFT();
      if (!(nft instanceof MidasDegenNFT)) {
        throw new Error(
          `mGLOBAL credit manager ${name} (${address}) has no Midas degen NFT`,
        );
      }
      await greenlistMidasGateway({
        anvil: this.client.anvil,
        investor,
        admin: DEFAULT_MIDAS_ADMIN,
        gateway: nft.gateway,
        logger: this.logger,
      });
      this.logger.info(
        `greenlisted ${investor} on mGLOBAL gateway ${nft.gateway}`,
      );
    } catch (e) {
      this.logger.error(
        `mGLOBAL workaround failed for credit manager ${name} (${address}): ${e}`,
      );
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
    preview: PartialStrategyPreview<bigint>,
  ): Promise<LiquidationRequest>;

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
          hf = this.sdk.marketRegister
            .findCreditManager(ca.creditManager)
            .optimalHFForPartialLiquidation(ca);
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
