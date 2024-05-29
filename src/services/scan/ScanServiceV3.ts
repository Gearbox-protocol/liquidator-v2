import type { Address } from "@gearbox-protocol/sdk-gov";
import {
  getTokenSymbolOrTicker,
  PERCENTAGE_FACTOR,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import {
  iCreditManagerV3Abi,
  iDataCompressorV3Abi,
} from "@gearbox-protocol/types/abi";
import type {
  CreditAccountData as ICreditAccountData,
  PriceOnDemand,
} from "@gearbox-protocol/types/v3";
import { ICreditManagerV3__factory } from "@gearbox-protocol/types/v3";
import { Inject, Service } from "typedi";
import type { GetContractReturnType } from "viem";
import { getContract, PublicClient } from "viem";

import { Logger, type LoggerInterface } from "../../log";
import { VIEM_PUBLIC_CLIENT } from "../../utils";
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
  blockNumber?: bigint;
}

type IDataCompressorContract = GetContractReturnType<
  typeof iDataCompressorV3Abi,
  PublicClient
>;

@Service()
export class ScanServiceV3 extends AbstractScanService {
  @Logger("ScanServiceV3")
  log: LoggerInterface;

  @Inject()
  oracle: OracleServiceV3;

  @Inject()
  redstone: RedstoneServiceV3;

  @Inject(VIEM_PUBLIC_CLIENT)
  publicClient: PublicClient;

  @Inject()
  _liquidatorService: LiquidatorService;

  #dataCompressor?: IDataCompressorContract;
  #processing: number | null = null;

  protected override async _launch(): Promise<void> {
    const dcAddr = await this.addressProvider.findService(
      "DATA_COMPRESSOR",
      300,
    );
    this.#dataCompressor = getContract({
      abi: iDataCompressorV3Abi,
      address: dcAddr,
      client: this.publicClient,
    });

    const block = await this.provider.getBlockNumber();
    await this.oracle.launch(block);
    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.updateAccounts(this.config.optimistic ? undefined : block);
  }

  protected override async onBlock(blockNumber: number): Promise<void> {
    if (this.#processing) {
      this.log.debug(
        `skipping block ${blockNumber}, still processing block ${this.#processing}`,
      );
      return;
    }
    this.#processing = blockNumber;
    await this.oracle.update(blockNumber);
    await this.updateAccounts(blockNumber);
    this.#processing = null;
  }

  /**
   * Loads new data and recompute all health factors
   * @param atBlock Fiex block for archive node which is needed to get data
   */
  protected async updateAccounts(atBlock?: number): Promise<void> {
    const start = new Date().getTime();
    const blockS = atBlock ? ` in ${atBlock}` : "";
    let [accounts, failedTokens] = await this.#potentialLiquidations(
      [],
      atBlock,
    );
    this.log.debug(
      `${accounts.length} potential accounts to liquidate${blockS}, ${failedTokens.length} failed tokens: ${printTokens(failedTokens)}`,
    );
    if (failedTokens.length) {
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
    }
    const time = Math.round((new Date().getTime() - start) / 1000);
    this.log.debug(
      `${accounts.length} accounts to liquidate${blockS}, time: ${time}s`,
    );
    // TODO: what to do when non-redstone price fails?
    if (failedTokens.length) {
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
    blockNumber?: number,
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
      blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
    };

    let accountsRaw: ICreditAccountData[] = [];

    if (debugAccounts?.length) {
      accountsRaw = await this.#getParticularAccounts(debugAccounts, selection);
    } else if (debugManagers?.length) {
      accountsRaw = await this.#getAccountsFromManagers(
        debugManagers as Address[],
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
    { liquidatableOnly, priceUpdates, blockNumber }: AccountSelection,
  ): Promise<ICreditAccountData[]> {
    const result: ICreditAccountData[] = [];
    for (const acc of accs) {
      const { result: accData } =
        await this.dataCompressor.simulate.getCreditAccountData(
          [acc as Address, priceUpdates as any],
          { blockNumber },
        );
      result.push(accData as any);
    }
    return liquidatableOnly
      ? this.#filterLiquidatable(result, blockNumber)
      : this.#filterZeroDebt(result);
  }

  // TODO: this can be nicely solved by exposing _queryCreditAccounts in DataCompressor
  async #getAllAccounts(
    selection: AccountSelection,
  ): Promise<ICreditAccountData[]> {
    const { liquidatableOnly, priceUpdates, blockNumber } = selection;
    const blockS = blockNumber ? ` in ${blockNumber}` : "";
    if (liquidatableOnly) {
      this.log.debug(
        `getting liquidatable credit accounts${blockS} with ${priceUpdates.length} price updates...`,
      );
      const start = new Date().getTime();
      const result =
        await this.dataCompressor.simulate.getLiquidatableCreditAccounts(
          [priceUpdates as any],
          { blockNumber },
        );
      const duration = Math.round((new Date().getTime() - start) / 1000);
      this.log.debug(`getLiquidatableCreditAccounts timing: ${duration}s`);
      return result.result as any;
    }
    const cms = await this.dataCompressor.read.getCreditManagersV3List({
      blockNumber,
    });
    this.log.debug(`found ${cms.length} credit managers`);
    return this.#getAccountsFromManagers(
      cms.map(m => m.addr),
      selection,
    );
  }

  async #getAccountsFromManagers(
    cms: Address[],
    { liquidatableOnly, priceUpdates, blockNumber }: AccountSelection,
  ): Promise<ICreditAccountData[]> {
    const all = await Promise.all(
      cms.map(cm =>
        this.dataCompressor.simulate.getCreditAccountsByCreditManager(
          [cm, priceUpdates as any],
          { blockNumber },
        ),
      ),
    );
    const accs = all.map(r => r.result).flat();
    this.log.debug(
      `loaded ${accs.length} credit accounts from ${cms.length} credit managers`,
    );
    return liquidatableOnly
      ? this.#filterLiquidatable(accs as any, blockNumber)
      : this.#filterZeroDebt(accs as any);
  }

  #filterZeroDebt(accs: ICreditAccountData[]): ICreditAccountData[] {
    return accs.filter(acc => acc.debt > 0n);
  }

  async #filterLiquidatable(
    accs: ICreditAccountData[],
    blockNumber?: bigint,
  ): Promise<ICreditAccountData[]> {
    this.log.debug(
      `filtering liquidatable credit accounts from selection of ${accs.length}...`,
    );
    // @ts-ignore
    const mc = await this.publicClient.multicall({
      blockNumber,
      allowFailure: true,
      contracts: accs.map(({ addr, creditManager }) => ({
        address: creditManager as Address,
        abi: iCreditManagerV3Abi,
        functionName: "isLiquidatable",
        args: [addr as Address, PERCENTAGE_FACTOR],
      })),
    });
    const result = accs.filter(
      (_, i) => mc[i].status === "success" && mc[i].result,
    );
    this.log.debug(`${result.length}/${accs.length} accounts are liquidatable`);
    return result;
  }

  protected override get liquidatorService(): ILiquidatorService {
    return this._liquidatorService;
  }

  private get dataCompressor(): IDataCompressorContract {
    if (!this.#dataCompressor) {
      throw new Error("data compressor not initialized");
    }
    return this.#dataCompressor;
  }
}

function printTokens(tokens: string[]): string {
  return tokens.map(getTokenSymbolOrTicker).join(", ");
}
