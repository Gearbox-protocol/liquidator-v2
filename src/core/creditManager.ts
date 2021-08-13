import {
  CreditAccountData,
  CreditAccountDataExtended,
  CreditManagerData,
  CreditManagerDataExtended,
  CreditManagerDataPayload,
  TokenData,
} from "@diesellabs/gearbox-sdk";
import {
  ICreditFilter,
  ICreditManager,
  ICreditManager__factory,
  IDataCompressor,
} from "../types/ethers-v5";
import { BigNumber, Signer } from "ethers";
import { LoggerInterface } from "../decorators/logger";
import { IPoolService } from "@diesellabs/gearbox-sdk/src/types/IPoolService";
import {
  ICreditFilter__factory,
  IPoolService__factory,
} from "@diesellabs/gearbox-sdk/lib/types";
import { ExecutorJob } from "./executor";
import { CreditAccount } from "./creditAccount";
import { Pool } from "./pool";
import { typedEventsComparator } from "../utils/events";
import { TokenService } from "../services/tokenService";
import { OracleService } from "../services/oracleService";
import { Container } from "typedi";

export class CreditManager extends CreditManagerData {
  protected readonly tokenService: TokenService;

  protected log: LoggerInterface;

  protected symbol: string;

  protected readonly creditAccounts: Record<string, CreditAccount>;
  protected readonly contract: ICreditManager;
  protected creditFilter: ICreditFilter;
  protected readonly dataCompressor: IDataCompressor;
  protected liquidationThresholds: Record<string, number>;
  protected pool: Pool;
  protected poolAddress: string;
  protected poolContract: IPoolService;
  protected lastSynced: number;
  protected signer: Signer;

  constructor(
    payload: CreditManagerDataPayload,
    dataCompressor: IDataCompressor,
    signer: Signer,
    log: LoggerInterface
  ) {
    super(payload);
    this.tokenService = Container.get(TokenService);
    this.log = log;
    this.contract = ICreditManager__factory.connect(payload.addr, signer);
    this.dataCompressor = dataCompressor;

    this.signer = signer;
    this.creditAccounts = {};
    this.liquidationThresholds = {};
  }

  async launch() {
    this.symbol =
      this.tokenService.symbol(this.underlyingToken) || this.underlyingToken;
    this.log = this.log.child({ label: `[Credit manager:${this.symbol}]` });
    this.poolAddress = await this.contract.poolService();
    this.poolContract = IPoolService__factory.connect(
      this.poolAddress,
      this.signer
    );
    const creditFilterAddress = await this.contract.creditFilter();
    this.creditFilter = ICreditFilter__factory.connect(
      creditFilterAddress,
      this.signer
    );
    await this.updatePool();
    await this.loadLiquidationThresholds();
    await this.loadCreditAccountsData();
    await this.subscribe();
  }

  update(timestamp: number): Array<CreditAccount> {
    const cumulativeIndex = this.pool.calcCurrentCumulativeIndex(timestamp);

    return Object.values(this.creditAccounts)
    .filter(
      (acc) =>
        acc.calcHealthFactor(this.liquidationThresholds, cumulativeIndex) < 1
    );
  }

  async loadCreditAccountsData() {
    const events = await this.contract.queryFilter({}, 0, "latest");
    const accountsMap: Record<string, boolean> = {};

    this.log.info("Loading credit accounts data...");

    try {
      events.forEach((e) => {
        const event = this.contract.interface.parseLog(e);
        switch (event.eventFragment.name) {
          case "OpenCreditAccount":
            accountsMap[event.args[1]] = true;
            break;

          case "CloseCreditAccount":
          case "RepayCreditAccount":
          case "LiquidateCreditAccount":
            accountsMap[event.args[0]] = false;
        }
      });
    } catch (e) {
      this.log.error(`cant get events for ${this.address} creditManager`);
      this.log.error(e);
      return;
    }

    const liveAccounts = Object.entries(accountsMap)
      .filter((e) => e[1])
      .map((e) => e[0]);

    try {
      for (let acc of liveAccounts) {
        await this.reloadAccount(acc);
      }
    } catch (e) {
      this.log.error(`cant get accounts data in ${this.address} creditManager`);
      this.log.error(e);
      return;
    }
    this.log.info(
      `Load ${Object.keys(this.creditAccounts).length} accounts...`
    );
  }

  async loadLiquidationThresholds() {
    this.log.info("Getting liquidation threshold...");

    try {
      const events = await this.creditFilter.queryFilter(
        this.creditFilter.filters.TokenAllowed()
      );

      events
        .sort(typedEventsComparator)
        .forEach(
          ({ args: { token, liquidityThreshold } }) =>
            (this.liquidationThresholds[token] = liquidityThreshold.toNumber())
        );

      this.log.info("Got liquidation threshold: ");
      Object.entries(this.liquidationThresholds).map(([token, lt]) =>
        this.log.debug(`[${this.tokenService.symbol(token)}]: ${lt}`)
      );
    } catch (e) {
      this.log.error("cant get liquidation threshold");
      this.log.error(e);
      process.exit(2);
    }
  }

  async subscribe() {
    this.contract.on("OpenCreditAccount", async (sender, onBehalfOf) => {
      await this.reloadAccount(onBehalfOf);
      this.log.info(`${this.logName} New account ${onBehalfOf} added`);
    });

    this.contract.on("OpenCreditAccount", async (sender, onBehalfOf) => {
      await this.reloadAccount(onBehalfOf);
      this.log.info(`${this.logName} New account ${onBehalfOf} added`);
    });

    this.contract.on("CloseCreditAccount", async (owner) => {
      this.log.info("Close credit account ", owner);
      await this.deleteAccount(owner);
    });

    this.contract.on("LiquidateCreditAccount", async (owner) => {
      this.log.info("Liquidate credit account ", owner);
      await this.deleteAccount(owner);
    });

    this.creditFilter.on(
      "TokenAllowed",
      (token, liquidityThreshold) =>
        (this.liquidationThresholds[token] = liquidityThreshold.toNumber())
    );

    // We update pool data at any event
    this.poolContract.on("*", async () => await this.updatePool());
  }

  async updatePool() {
    this.log.info("Connecting pool contract...");
    const poolPayload = await this.dataCompressor.getPoolData(this.poolAddress);
    this.pool = new Pool(poolPayload);
  }

  async reloadAccount(address: string) {
    const creditAccountPayload =
      await this.dataCompressor.getCreditAccountDataExtended(
        this.address,
        address
      );

    this.creditAccounts[address] = new CreditAccount(creditAccountPayload);
  }

  async deleteAccount(address: string) {
    delete this.creditAccounts[address];
  }

  get logName(): string {
    return `[Credit manager ${this.underlyingToken}]:`;
  }
}
