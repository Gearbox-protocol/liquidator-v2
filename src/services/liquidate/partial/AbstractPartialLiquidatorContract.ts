import type {
  CreditAccountData,
  CreditSuite,
  Curator,
  GearboxSDK,
  ICreditAccountsService,
  OnDemandPriceUpdates,
} from "@gearbox-protocol/sdk";
import { ADDRESS_0X0, AddressMap } from "@gearbox-protocol/sdk";
import { iDegenDistributorV300Abi } from "@gearbox-protocol/sdk/abi/iDegenDistributorV300";
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
import { PartialLiquidationBotV310Contract } from "../../PartialLiquidationBotV310Contract.js";
import type { PartialLiquidationPreview } from "../types.js";
import type {
  IPartialLiquidatorContract,
  MerkleDistributorInfo,
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

  #registeredCMs = new AddressMap<boolean>();
  #address?: Address;
  #router: Address;
  /**
   * Credit managers for which async write operations (register, obtaining degen, etc...) are pending
   */
  #pendingCreditManagers: CreditSuite[] = [];
  #optimalDeleverageHF = new AddressMap<bigint>();

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
    if (this.config.liquidationMode === "deleverage") {
      // this operation is cached and will be called only once
      // so it's safe to be used inside syncState
      await this.#setOptimalDeleverageHF();
    }

    if (this.#pendingCreditManagers.length === 0) {
      return;
    }
    // only affects pending credit managers
    // so it's safe to be used inside syncState
    const creditAccounts = await this.#getLiquidatorAccounts();

    try {
      await this.#claimDegenNFTs(creditAccounts);
    } catch (e) {
      this.logger.warn(`failed to obtain degen NFTs: ${e}`);
    }

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

  /**
   * Claim NFT tokens as liquidator contract, so that the contract can open credit accounts in Degen NFT protected credit managers
   * @returns
   */
  async #claimDegenNFTs(creditAccounts: AddressMap<Address>): Promise<void> {
    const account = this.address;
    let nfts = 0;
    for (const cm of this.#pendingCreditManagers) {
      const { address, name } = cm.creditManager;
      const { degenNFT } = cm.creditFacade;
      const account = creditAccounts.get(address);
      if (account === ADDRESS_0X0 && degenNFT !== ADDRESS_0X0) {
        this.logger.debug(
          `need degen NFT ${degenNFT} for credit manager ${name}`,
        );
        nfts++;
      }
    }
    if (nfts === 0) {
      return;
    }
    const mcs =
      this.creditAccountService.sdk.marketRegister.marketConfigurators;

    if (mcs.length !== 1) {
      throw new Error(
        "claim degen NFT works only with single market configurator",
      );
    }

    const distributor = await mcs[0].getPeripheryContract("DEGEN_DISTRIBUTOR");
    this.logger.debug(`degen distributor: ${distributor}`);
    const [distributorNFT, merkelRoot, claimed] =
      await this.client.pub.multicall({
        allowFailure: false,
        contracts: [
          {
            address: distributor,
            abi: iDegenDistributorV300Abi,
            functionName: "degenNFT",
          },
          {
            address: distributor,
            abi: iDegenDistributorV300Abi,
            functionName: "merkleRoot",
          },
          {
            address: distributor,
            abi: iDegenDistributorV300Abi,
            functionName: "claimed",
            args: [account],
          },
        ],
      });
    const merkleRootURL = `https://dm.gearbox.fi/${this.config.network.toLowerCase()}_${merkelRoot}.json`;
    this.logger.debug(
      `merkle root: ${merkleRootURL}, degen distributor NFT: ${distributorNFT}, claimed: ${claimed}`,
    );

    const resp = await fetch(merkleRootURL);
    const merkle = (await resp.json()) as MerkleDistributorInfo;
    const claims = merkle.claims[account];
    if (!claims) {
      throw new Error(`${account} is not eligible for degen NFT claim`);
    }
    this.logger.debug(claims, `claims`);
    if (BigInt(claims.amount) <= claimed) {
      throw new Error(`already claimed`);
    }

    const receipt = await this.client.simulateAndWrite({
      address: distributor,
      abi: iDegenDistributorV300Abi,
      functionName: "claim",
      args: [
        BigInt(claims.index), // uint256 index,
        account, // address account,
        BigInt(claims.amount), // uint256 totalAmount,
        claims.proof, // bytes32[] calldata merkleProof
      ],
    });
    if (receipt.status === "reverted") {
      throw new Error(`degenDistributor.claim reverted`);
    }
    this.logger.debug(`${account} claimed ${BigInt(claims.amount)} degenNFTs`);
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
    priceUpdates: OnDemandPriceUpdates,
  ): Promise<OptimalPartialLiquidation>;

  public abstract previewPartialLiquidation(
    ca: CreditAccountData,
    cm: CreditSuite,
    optimalLiquidation: OptimalPartialLiquidation,
    priceUpdates: OnDemandPriceUpdates,
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
      return this.#getOptimalDeleverageHF();
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

  protected get sdk(): GearboxSDK {
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

  async #setOptimalDeleverageHF(): Promise<void> {
    if (this.#optimalDeleverageHF.has(this.partialLiquidationBot)) {
      return;
    }
    const [minHealthFactor, maxHealthFactor] =
      await PartialLiquidationBotV310Contract.get(
        this.sdk,
        this.partialLiquidationBot,
      ).loadHealthFactors();
    const hf = BigInt(minHealthFactor + maxHealthFactor) / 2n;
    this.#optimalDeleverageHF.upsert(this.partialLiquidationBot, hf);
    this.logger.debug(`set optimal deleverage HF to ${hf}`);
  }

  #getOptimalDeleverageHF(): bigint {
    if (!this.#optimalDeleverageHF.has(this.partialLiquidationBot)) {
      throw new Error("optimal deleverage HF not configured");
    }
    return this.#optimalDeleverageHF.mustGet(this.partialLiquidationBot);
  }
}
