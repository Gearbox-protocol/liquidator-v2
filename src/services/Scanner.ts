import type {
  CreditAccountData,
  CreditAccountServiceOptions,
  GearboxSDK,
  GetCreditAccountsOptions,
  ICreditAccountsService,
  NetworkType,
} from "@gearbox-protocol/sdk";
import {
  AbstractCreditAccountService,
  hexEq,
  MAX_UINT256,
  PERCENTAGE_FACTOR,
  WAD,
} from "@gearbox-protocol/sdk";
import { iBotListV310Abi } from "@gearbox-protocol/sdk/abi/v310";
import { getAlchemyUrl, getDrpcUrl } from "@gearbox-protocol/sdk/dev";
import {
  iCreditManagerV3Abi,
  iPartialLiquidationBotV3Abi,
} from "@gearbox-protocol/types/abi";
import type { Address, Block, HttpTransportConfig, PublicClient } from "viem";
import { createPublicClient, getContract, http } from "viem";
import type { Config } from "../config/index.js";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import type MulticallSpy from "../MulticallSpy.js";
import type Client from "./Client.js";
import type { ILiquidatorService } from "./liquidate/index.js";
import type { INotifier } from "./notifier/index.js";

const RESTAKING_CMS: Partial<Record<NetworkType, Address>> = {
  Mainnet:
    "0x50ba483272484fc5eebe8676dc87d814a11faef6".toLowerCase() as Address, // Mainnet WETH_V3_RESTAKING
  Arbitrum:
    "0xcedaa4b4a42c0a771f6c24a3745c3ca3ed73f17a".toLowerCase() as Address, // Arbitrum WETH_V3_TRADE_TIER_1
};

@DI.Injectable(DI.Scanner)
export class Scanner {
  @Logger("Scanner")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.Liquidator)
  liquidatorService!: ILiquidatorService;

  @DI.Inject(DI.CreditAccountService)
  caService!: ICreditAccountsService;

  #processing: bigint | null = null;
  #restakingCMAddr?: Address;
  #restakingMinHF?: bigint;
  #lastUpdated = 0n;
  #maxHealthFactor = MAX_UINT256;
  #minHealthFactor = 0n;
  #unwatch?: () => void;
  #diagnoster?: ScannerDiagnoster;

  public async launch(): Promise<void> {
    await this.liquidatorService.launch();
    if (this.config.restakingWorkaround) {
      await this.#setupRestakingWorkaround();
    }

    const block = await this.client.pub.getBlock();

    this.#maxHealthFactor = this.config.hfThreshold;
    this.#minHealthFactor = this.config.optimistic ? 0n : 1n;
    if (this.config.optimistic && this.config.liquidationMode === "partial") {
      this.#maxHealthFactor = MAX_UINT256;
    }
    if (this.config.liquidationMode === "deleverage") {
      if (this.config.optimistic) {
        this.#minHealthFactor = 0n;
        this.#maxHealthFactor = MAX_UINT256;
      } else {
        this.#minHealthFactor = WAD;
        const botMinHealthFactor = await this.client.pub.readContract({
          address: this.config.partialLiquidationBot,
          abi: iPartialLiquidationBotV3Abi,
          functionName: "minHealthFactor",
        });
        this.#maxHealthFactor =
          (BigInt(botMinHealthFactor) * WAD) / PERCENTAGE_FACTOR;
        this.log.info(
          `deleverage bot max health factor is ${botMinHealthFactor / 100}%  (${this.#maxHealthFactor})`,
        );
      }
    }

    if (this.config.debugScanner) {
      this.#diagnoster = new ScannerDiagnoster();
    }

    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.#updateAccounts(
      this.config.optimistic ? undefined : block.number,
    );
    if (!this.config.optimistic) {
      this.#unwatch = this.client.pub.watchBlocks({
        onBlock: b => this.#onBlock(b),
        includeTransactions: false,
      });
    }
  }

  async #onBlock(block: Block<bigint, false, "latest">): Promise<void> {
    const { number: blockNumber, timestamp } = block;
    if (this.#processing) {
      this.log.debug(
        `skipping block ${blockNumber}, still processing block ${this.#processing}`,
      );
      return;
    }
    try {
      this.#processing = blockNumber;
      await this.caService.sdk.syncState({
        blockNumber,
        timestamp,
        // this effectively updates chainlink prices
        // we don't need this
        // if there're new price feeds, syncState will pick them up anyway
        // and redstone price updates will be updated in credit account service calls
        skipPriceUpdate: true,
      });
      await this.liquidatorService.syncState(blockNumber);
      await this.#updateAccounts(blockNumber);
      this.#lastUpdated = blockNumber;
    } catch (e) {
      this.log.error(
        new Error(`failed to process block ${blockNumber}`, { cause: e }),
      );
      // this.#lastUpdated will not change in case of failed block
      // if this happens for multiple blocks, this error should be caught by metrics monitor, since lastUpdated metric will be stagnant
    } finally {
      this.#processing = null;
    }
  }

  /**
   * Loads new data and recompute all health factors
   * @param blockNumber Fixed block for archive node which is needed to get data
   */
  async #updateAccounts(blockNumber?: bigint): Promise<void> {
    const start = Date.now();
    const blockS = blockNumber ? ` in ${blockNumber}` : "";
    let accounts: CreditAccountData[] = [];
    if (this.config.debugAccount) {
      const acc = await this.caService.getCreditAccountData(
        this.config.debugAccount,
        blockNumber,
      );
      accounts = acc ? [acc] : [];
    } else {
      const queue: GetCreditAccountsOptions = {
        minHealthFactor: this.#minHealthFactor,
        maxHealthFactor: this.#maxHealthFactor,
        includeZeroDebt: false,
        creditManager: this.config.debugManager,
        ignoreReservePrices:
          this.config.liquidationMode !== "deleverage" &&
          !this.config.updateReservePrices,
      };
      accounts = await this.caService.getCreditAccounts(queue, blockNumber);
      if (this.#diagnoster) {
        accounts = await this.#diagnoster.checkAccounts(
          accounts,
          queue,
          blockNumber,
        );
      }
    }
    if (this.config.restakingWorkaround) {
      const before = accounts.length;
      accounts = this.#filterRestakingAccounts(accounts);
      this.log.debug(
        `filtered out ${before - accounts.length} restaking accounts`,
      );
    }
    if (this.config.lskEthWorkaround) {
      const before = accounts.length;
      accounts = await this.#filterLskETH(accounts);
      this.log.debug(
        `filtered out ${before - accounts.length} lskETH accounts`,
      );
    }
    if (this.config.ignoreAccounts) {
      const before = accounts.length;
      const ignoreAccounts = new Set(
        this.config.ignoreAccounts?.map(a => a.toLowerCase()),
      );
      accounts = accounts.filter(
        ca => !ignoreAccounts.has(ca.creditAccount.toLowerCase()),
      );
      this.log.debug(
        `filtered out ${before - accounts.length} ignored accounts`,
      );
    }

    if (this.config.liquidationMode === "deleverage") {
      accounts = await this.#filterDeleverageAccounts(
        accounts,
        this.config.partialLiquidationBot,
        blockNumber,
      );
    }

    const time = Math.round((Date.now() - start) / 1000);
    const verb =
      this.config.liquidationMode === "deleverage"
        ? "deleveragable"
        : "liquidatable";
    this.log.debug(
      `${accounts.length} accounts to ${verb}${blockS}, time: ${time}s`,
    );

    if (this.config.optimistic) {
      await this.liquidatorService.liquidateOptimistic(accounts);
    } else {
      await this.liquidatorService.liquidate(accounts);
    }
  }

  async #setupRestakingWorkaround(): Promise<void> {
    this.#restakingCMAddr = RESTAKING_CMS[this.config.network];

    if (this.#restakingCMAddr) {
      const ezETH = this.caService.sdk.tokensMeta.mustFindBySymbol("ezETH");
      const cm = getContract({
        abi: iCreditManagerV3Abi,
        address: this.#restakingCMAddr,
        client: this.client.pub,
      });
      const [[, , liquidationDiscount], ezETHLT] = await Promise.all([
        cm.read.fees(),
        cm.read.liquidationThresholds([ezETH.addr]),
      ]);

      // For restaking accounts, say for simplicity account with only ezETH:
      //
      //        price(ezETH) * balance(ezETH) * LT(ezETH)
      // HF = ----------------------------------------------
      //                     debt(WETH)
      //
      // Assuming that price(ezETH) at some point becomes 1 (when you can withdraw ezETH):
      //
      //               balance(ezETH) * LT(ezETH)
      // debt(WETH) = ----------------------------
      //                        HF
      //
      // Amount that goes to gearbox + to account owner (if any) when account is liquidated:
      // liquidationDiscount == 100% - liquidatorPremium
      //
      // discounted = balance(ezETH) * LiquidationDiscount
      //
      // To avoid bad debt (discounted >= debt):
      //
      //                                           balance(ezETH) * LT(ezETH)
      // balance(ezETH) * LiquidationDiscount >=  ---------------------------
      //                                                        HF
      //          LT(ezETH)
      // HF >= --------------------
      //       LiquidationDiscount
      //
      // So it's safe to liquidate accounts with such HF, otherwise we get into bad debt zone
      // For current settings of  Restaking WETH credit manager on mainnet it translates to HF >= 91.50% / 0.97 == 94.33%
      this.#restakingMinHF =
        (PERCENTAGE_FACTOR * BigInt(ezETHLT)) / BigInt(liquidationDiscount);
      this.log.warn(
        {
          restakingCMAddr: this.#restakingCMAddr,
          liquidationDiscount,
          ezETHLT,
          restakingMinHF: this.#restakingMinHF,
        },
        "restaking workaround enabled",
      );
    }
  }

  #filterRestakingAccounts(accounts: CreditAccountData[]): CreditAccountData[] {
    return accounts.filter(ca => {
      if (
        this.#restakingCMAddr === ca.creditManager.toLowerCase() &&
        !!this.#restakingMinHF
      ) {
        const ok = ca.healthFactor >= this.#restakingMinHF;
        if (!ok) {
          this.log.debug(
            `filtered out ${ca.creditAccount} due to restaking workaround (HF ${ca.healthFactor} < ${this.#restakingMinHF})`,
          );
        }
        return ok;
      }
      return true;
    });
  }

  async #filterLskETH(
    accounts: CreditAccountData[],
  ): Promise<CreditAccountData[]> {
    if (this.config.network !== "Lisk" || this.config.optimistic) {
      return accounts;
    }
    // 0x1b10E2270780858923cdBbC9B5423e29fffD1A44 [lskETH]
    return accounts.filter(
      ca =>
        !ca.tokens.some(t =>
          hexEq(t.token, "0x1b10E2270780858923cdBbC9B5423e29fffD1A44"),
        ),
    );
  }

  async #filterDeleverageAccounts(
    accounts: CreditAccountData[],
    partialLiquidationBot: Address,
    blockNumber?: bigint,
  ): Promise<CreditAccountData[]> {
    const botList = this.caService.sdk.botListContract?.address;
    if (!botList) {
      this.log.warn(
        "bot list contract not found, skipping deleverage accounts filtering",
      );
      return accounts;
    }
    const res = await this.client.pub.multicall({
      contracts: accounts.map(
        ca =>
          ({
            address: botList,
            abi: iBotListV310Abi,
            functionName: "getBotStatus",
            args: [partialLiquidationBot, ca.creditAccount],
          }) as const,
      ),
      allowFailure: true,
      blockNumber,
    });
    const result: CreditAccountData[] = [];
    let errored = 0;
    for (let i = 0; i < accounts.length; i++) {
      const ca = accounts[i];
      const r = res[i];
      if (r.status === "success") {
        const [permissions, forbidden] = r.result;
        if (!!permissions && !forbidden) {
          result.push(ca);
        }
      } else if (r.status === "failure") {
        errored++;
      }
    }
    this.log.debug(
      { errored, before: accounts.length, after: result.length, botList },
      "filtered accounts for deleverage",
    );
    return result;
  }

  public get lastUpdated(): bigint {
    return this.#lastUpdated;
  }

  public async stop(): Promise<void> {
    this.#unwatch?.();
    this.log.info("stopped");
  }
}

class ScannerDiagnoster {
  @Logger("ScannerDiagnoster")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.CreditAccountService)
  caService!: ICreditAccountsService;

  @DI.Inject(DI.Notifier)
  notifier!: INotifier;

  @DI.Inject(DI.MulticallSpy)
  multicallSpy!: MulticallSpy;

  #drpc?: WorkaroundCAS;
  #alchemy?: WorkaroundCAS;

  constructor() {
    if (this.config.drpcKeys?.length) {
      const rpcURL = getDrpcUrl(
        this.config.network,
        this.config.drpcKeys[0].value,
        "http",
      );
      if (rpcURL) {
        this.#drpc = new WorkaroundCAS(this.caService.sdk, {
          rpcURL,
          rpcOptions: {
            onFetchRequest: this.multicallSpy.spy.onFetchRequest,
            onFetchResponse: this.multicallSpy.spy.onFetchResponse,
          },
        });
      }
    }
    if (this.config.alchemyKeys?.length) {
      const rpcURL = getAlchemyUrl(
        this.config.network,
        this.config.alchemyKeys[0].value,
        "http",
      );
      if (rpcURL) {
        this.#alchemy = new WorkaroundCAS(this.caService.sdk, {
          rpcURL,
          rpcOptions: {
            onFetchRequest: this.multicallSpy.spy.onFetchRequest,
            onFetchResponse: this.multicallSpy.spy.onFetchResponse,
          },
        });
      }
    }
    if (!!this.#drpc && !!this.#alchemy) {
      this.log.info("scanner diagnoster enabled");
    }
  }

  public async checkAccounts(
    accounts: CreditAccountData[],
    queue: GetCreditAccountsOptions,
    blockNumber?: bigint,
  ): Promise<CreditAccountData[]> {
    try {
      if (!accounts.length || !blockNumber || this.config.optimistic) {
        return accounts;
      }
      const numZeroHF = accounts.filter(a => a.healthFactor === 0n).length;
      let [success, drpcSuccess, dprcZeroHF, alchemySuccess, alchemyZeroHF] = [
        0, 0, 0, 0, 0,
      ];
      for (const a of accounts) {
        success += a.success ? 1 : 0;
      }
      this.log.debug(
        `found ${accounts.length} liquidatable accounts (${success} successful, ${numZeroHF} zero HF) in block ${blockNumber}`,
      );
      if (!this.#drpc || !this.#alchemy || numZeroHF === 0) {
        return accounts;
      }
      const [drpcAccs, alchemyAccs] = await Promise.all([
        this.#drpc.getCreditAccounts(queue, blockNumber),
        this.#alchemy.getCreditAccounts(queue, blockNumber),
      ]);
      for (const a of drpcAccs) {
        dprcZeroHF += a.healthFactor === 0n ? 1 : 0;
        drpcSuccess += a.success ? 1 : 0;
      }
      for (const a of alchemyAccs) {
        alchemyZeroHF += a.healthFactor === 0n ? 1 : 0;
        alchemySuccess += a.success ? 1 : 0;
      }
      this.log.debug(
        `found ${drpcAccs.length} liquidatable accounts (${drpcSuccess} successful, ${dprcZeroHF} zero HF) in block ${blockNumber} with drpc`,
      );
      this.log.debug(
        `found ${alchemyAccs.length} liquidatable accounts (${alchemySuccess} successful, ${alchemyZeroHF} zero HF) in block ${blockNumber} with alchemy`,
      );
      this.notifier.alert({
        plain: `Found ${numZeroHF} zero HF accounts in block ${blockNumber}, second pass ${dprcZeroHF} drpc, ${alchemyZeroHF} alchemy`,
        markdown: `Found ${numZeroHF} zero HF accounts in block ${blockNumber}, second pass ${dprcZeroHF} drpc, ${alchemyZeroHF} alchemy`,
      });
      await this.multicallSpy.dumpCalls();
      return alchemyZeroHF < dprcZeroHF ? alchemyAccs : drpcAccs;
    } catch (e) {
      this.log.error(e);
      return accounts;
    }
  }
}

interface WorkaroundCASOptions extends CreditAccountServiceOptions {
  rpcURL: string;
  rpcOptions?: HttpTransportConfig;
}

class WorkaroundCAS extends AbstractCreditAccountService {
  #client: PublicClient;

  constructor(sdk: GearboxSDK, opts: WorkaroundCASOptions) {
    super(sdk, opts);
    this.#client = createPublicClient({
      transport: http(opts.rpcURL, {
        timeout: 600_000,
        ...opts.rpcOptions,
      }),
      chain: sdk.provider.chain,
    });
  }

  public override get client(): PublicClient {
    return this.#client;
  }
}
