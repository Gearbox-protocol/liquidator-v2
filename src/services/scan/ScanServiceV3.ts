import type { MCall } from "@gearbox-protocol/sdk-gov";
import {
  getTokenSymbolOrTicker,
  PERCENTAGE_FACTOR,
  safeMulticall,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import type {
  CreditAccountDataStructOutput,
  ICreditManagerV3,
  IDataCompressorV3,
  PriceOnDemand,
} from "@gearbox-protocol/types/v3";
import {
  ICreditManagerV3__factory,
  IDataCompressorV3__factory,
} from "@gearbox-protocol/types/v3";
import type { Overrides } from "ethers";
import { Inject, Service } from "typedi";

import { Logger, type LoggerInterface } from "../../log";
import { CreditAccountData } from "../../utils/ethers-6-temp";
import type { ILiquidatorService } from "../liquidate";
import { LiquidatorService } from "../liquidate";
import OracleServiceV3 from "../OracleServiceV3";
import { RedstoneServiceV3 } from "../RedstoneServiceV3";
import AbstractScanService from "./AbstractScanService";

const iCreditManagerV3 = ICreditManagerV3__factory.createInterface();

interface AccountSelection {
  liquidatableOnly: boolean;
  priceUpdates: PriceOnDemand[];
  overrides?: Overrides;
}

@Service()
export class ScanServiceV3 extends AbstractScanService {
  @Logger("ScanServiceV3")
  log: LoggerInterface;

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  redstone: RedstoneServiceV3;

  @Inject()
  _liquidatorService: LiquidatorService;

  #dataCompressor?: IDataCompressorV3;
  #processing: number | null = null;

  protected override async _launch(): Promise<void> {
    const start = new Date().getTime();
    const dcAddr = await this.addressProvider.findService(
      "DATA_COMPRESSOR",
      300,
    );
    this.#dataCompressor = IDataCompressorV3__factory.connect(
      dcAddr,
      this.provider,
    );

    const block = await this.provider.getBlockNumber();
    await this.oracle.launch(block);
    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.updateAccounts(this.config.optimistic ? undefined : block);
    const ms = new Date().getTime() - start;
    this.log.debug(`launched in ${ms} ms`);
  }

  protected override async onBlock(blockNumber: number): Promise<void> {
    if (this.#processing) {
      this.log.debug(
        `skipping block ${blockNumber}, still processing block ${this.#processing}`,
      );
      return;
    }
    const start = new Date().getTime();
    this.#processing = blockNumber;
    await this.oracle.update(blockNumber);
    await this.updateAccounts(blockNumber);
    this.#processing = null;
    const ms = new Date().getTime() - start;
    this.log.debug(`processed block ${blockNumber} in ${ms} ms`);
  }

  /**
   * Loads new data and recompute all health factors
   * @param atBlock Fiex block for archive node which is needed to get data
   */
  protected async updateAccounts(atBlock?: number): Promise<void> {
    const blockS = atBlock ? ` in ${atBlock}` : "";
    let [accounts, failedTokens] = await this.#potentialLiquidations(
      [],
      atBlock,
    );
    this.log.debug(
      `${accounts.length} potential accounts to liquidate${blockS}, ${failedTokens.length} failed tokens: ${printTokens(failedTokens)}`,
    );
    const redstoneUpdates = await this.redstone.updatesForTokens(
      failedTokens,
      true,
    );
    const redstoneTokens = redstoneUpdates.map(({ token }) => token);
    this.log.debug(
      `got ${redstoneTokens.length} redstone price updates${blockS}: ${printTokens(redstoneTokens)}`,
    );
    [accounts, failedTokens] = await this.#potentialLiquidations(
      redstoneUpdates,
      atBlock,
    );
    this.log.debug(`${accounts.length} accounts to liquidate${blockS}`);
    // TODO: what to do when non-redstone price fails?
    if (failedTokens.length > 0) {
      this.log.error(
        `failed tokens on second iteration${blockS}: ${printTokens(failedTokens)}`,
      );
    }

    if (this.config.optimistic) {
      await this.liquidateOptimistically(accounts);
    } else {
      await this.liquidateNormal(accounts);
    }
  }

  /**
   * Finds all potentially liquidatable credit accounts
   *
   * Returns
   * @param atBlock
   * @returns
   */
  async #potentialLiquidations(
    priceUpdates: PriceOnDemand[],
    atBlock?: number | undefined,
  ): Promise<[accounts: CreditAccountData[], failedTokens: string[]]> {
    const {
      optimistic,
      debugAccounts,
      debugManagers,
      deployPartialLiquidatorContracts,
      partialLiquidatorAddress,
      underlying,
    } = this.config;
    // during partial + optimistic liquidation, liquidation condition is not created externally.
    // it's created by liquidator itself before the liquidation.
    const liquidatableOnly =
      !optimistic ||
      (!deployPartialLiquidatorContracts && !partialLiquidatorAddress);

    const selection: AccountSelection = {
      liquidatableOnly,
      priceUpdates,
      overrides: atBlock ? { blockTag: atBlock } : {},
    };

    let accountsRaw: CreditAccountDataStructOutput[] = [];

    if (debugAccounts?.length) {
      accountsRaw = await this.#getParticularAccounts(debugAccounts, selection);
    } else if (debugManagers?.length) {
      accountsRaw = await this.#getAccountsFromManagers(
        debugManagers,
        selection,
      );
    } else {
      accountsRaw = await this.#getAllAccounts(selection);
    }
    let accounts = accountsRaw.map(a => new CreditAccountData(a));

    accounts = accounts.filter(ca => {
      const ok = ca.healthFactor < this.config.hfThreshold;
      // 65535 is zero-debt account, no need to warn about it
      if (!ok && ca.healthFactor !== 65535) {
        this.log.warn(
          `health factor of ${ca.name} ${ca.healthFactor} > ${this.config.hfThreshold} threshold, skipping`,
        );
      }
      return ok;
    });

    // in optimistic mode, we can limit liquidations to all CM with provided underlying symbol
    if (underlying) {
      this.log.debug(`filtering accounts by underlying: ${underlying}`);
      accounts = accounts.filter(a => {
        const u = tokenSymbolByAddress[a.underlyingToken];
        return underlying.toLowerCase() === u?.toLowerCase();
      });
    }

    const failedTokens = new Set<string>();
    for (const acc of accounts) {
      acc.priceFeedsNeeded.forEach(t => failedTokens.add(t));
    }

    return [accounts, Array.from(failedTokens)];
  }

  async #getParticularAccounts(
    accs: string[],
    { liquidatableOnly, priceUpdates, overrides = {} }: AccountSelection,
  ): Promise<CreditAccountDataStructOutput[]> {
    const result: CreditAccountDataStructOutput[] = [];
    for (const acc of accs) {
      const accData = await this.dataCompressor.getCreditAccountData.staticCall(
        acc,
        priceUpdates,
        overrides,
      );
      result.push(accData);
    }
    return liquidatableOnly
      ? this.#filterLiquidatable(result, overrides)
      : this.#filterZeroDebt(result);
  }

  // TODO: this can be nicely solved by exposing _queryCreditAccounts in DataCompressor
  async #getAllAccounts(
    selection: AccountSelection,
  ): Promise<CreditAccountDataStructOutput[]> {
    const { liquidatableOnly, priceUpdates, overrides = {} } = selection;
    const blockS = overrides.blockTag ? ` in ${overrides.blockTag}` : "";
    if (liquidatableOnly) {
      this.log.debug(
        `getting liquidatable credit accounts${blockS} with ${priceUpdates.length} price updates...`,
      );
      return this.dataCompressor.getLiquidatableCreditAccounts.staticCall(
        priceUpdates,
        overrides,
      );
    }
    const cms = await this.dataCompressor.getCreditManagersV3List(overrides);
    this.log.debug(`found ${cms.length} credit managers`);
    return this.#getAccountsFromManagers(
      cms.map(m => m.addr),
      selection,
    );
  }

  async #getAccountsFromManagers(
    cms: string[],
    { liquidatableOnly, priceUpdates, overrides = {} }: AccountSelection,
  ): Promise<CreditAccountDataStructOutput[]> {
    const all = await Promise.all(
      cms.map(cm =>
        this.dataCompressor.getCreditAccountsByCreditManager.staticCall(
          cm,
          priceUpdates,
          overrides,
        ),
      ),
    );
    const accs = all.flat();
    this.log.debug(
      `loaded ${accs.length} credit accounts from ${cms.length} credit managers`,
    );
    return liquidatableOnly
      ? this.#filterLiquidatable(accs, overrides)
      : this.#filterZeroDebt(accs);
  }

  #filterZeroDebt(
    accs: CreditAccountDataStructOutput[],
  ): CreditAccountDataStructOutput[] {
    return accs.filter(acc => acc.debt > 0n);
  }

  async #filterLiquidatable(
    accs: CreditAccountDataStructOutput[],
    overrides: Overrides,
  ): Promise<CreditAccountDataStructOutput[]> {
    this.log.debug(
      `filtering liquidatable credit accounts from selection of ${accs.length}...`,
    );
    const calls: MCall<ICreditManagerV3["interface"]>[] = [];
    for (const { addr, creditManager } of accs) {
      calls.push({
        address: creditManager,
        interface: iCreditManagerV3,
        method: "isLiquidatable",
        params: [addr, PERCENTAGE_FACTOR],
      });
    }
    const resp = await safeMulticall<boolean>(calls, this.provider, overrides);
    const result = accs.filter((_, i) => resp[i].value);
    this.log.debug(`${result.length}/${accs.length} accounts are liquidatable`);
    return result;
  }

  protected override get liquidatorService(): ILiquidatorService {
    return this._liquidatorService;
  }

  private get dataCompressor(): IDataCompressorV3 {
    if (!this.#dataCompressor) {
      throw new Error("data compressor not initialized");
    }
    return this.#dataCompressor;
  }
}

function printTokens(tokens: string[]): string {
  return tokens.map(getTokenSymbolOrTicker).join(", ");
}
