import type { Address, NetworkType } from "@gearbox-protocol/sdk-gov";
import {
  getTokenSymbolOrTicker,
  PERCENTAGE_FACTOR,
  tokenDataByNetwork,
} from "@gearbox-protocol/sdk-gov";
import {
  iCreditManagerV3Abi,
  iDataCompressorV3Abi,
} from "@gearbox-protocol/types/abi";
import { BaseError, getContract } from "viem";

import type { Config } from "../../config/index.js";
import type { CreditAccountDataRaw } from "../../data/index.js";
import { CreditAccountData } from "../../data/index.js";
import { DI } from "../../di.js";
import { ErrorHandler } from "../../errors/index.js";
import { type ILogger, Logger } from "../../log/index.js";
import {
  type IDataCompressorContract,
  simulateMulticall,
} from "../../utils/index.js";
import type { AddressProviderService } from "../AddressProviderService.js";
import type Client from "../Client.js";
import type {
  ILiquidatorService,
  PriceOnDemandExtras,
} from "../liquidate/index.js";
import type OracleServiceV3 from "../OracleServiceV3.js";
import type { RedstoneServiceV3 } from "../RedstoneServiceV3.js";

const RESTAKING_CMS: Partial<Record<NetworkType, Address>> = {
  Mainnet:
    "0x50ba483272484fc5eebe8676dc87d814a11faef6".toLowerCase() as Address, // Mainnet WETH_V3_RESTAKING
  Arbitrum:
    "0xcedaa4b4a42c0a771f6c24a3745c3ca3ed73f17a".toLowerCase() as Address, // Arbitrum WETH_V3_TRADE_TIER_1
};

interface AccountSelection {
  liquidatableOnly: boolean;
  priceUpdates: PriceOnDemandExtras[];
  blockNumber?: bigint;
}

@DI.Injectable(DI.Scanner)
export class Scanner {
  @Logger("Scanner")
  log!: ILogger;

  @DI.Inject(DI.Config)
  config!: Config;

  @DI.Inject(DI.AddressProvider)
  addressProvider!: AddressProviderService;

  @DI.Inject(DI.Client)
  client!: Client;

  @DI.Inject(DI.Oracle)
  oracle!: OracleServiceV3;

  @DI.Inject(DI.Redstone)
  redstone!: RedstoneServiceV3;

  @DI.Inject(DI.Liquidator)
  liquidatorService!: ILiquidatorService;

  #dataCompressor?: IDataCompressorContract;
  #processing: bigint | null = null;
  #restakingCMAddr?: Address;
  #restakingMinHF?: bigint;
  #lastUpdated = 0n;
  #lastTimestamp = 0n;
  #errorHandler?: ErrorHandler;

  public async launch(): Promise<void> {
    this.#errorHandler = new ErrorHandler(this.config, this.log);
    await this.liquidatorService.launch();
    if (this.config.restakingWorkaround) {
      await this.#setupRestakingWorkaround();
    }
    const dcAddr = this.addressProvider.findService("DATA_COMPRESSOR", 300);
    this.#dataCompressor = getContract({
      abi: iDataCompressorV3Abi,
      address: dcAddr,
      client: this.client.pub,
    });

    const block = await this.client.pub.getBlockNumber();
    await this.oracle.launch(block);
    // we should not pin block during optimistic liquidations
    // because during optimistic liquidations we need to call evm_mine to make redstone work
    await this.#updateAccounts(this.config.optimistic ? undefined : block);
    if (!this.config.optimistic) {
      this.client.pub.watchBlocks({
        onBlock: b => this.#onBlock(b.number, b.timestamp),
      });
    }
  }

  async #onBlock(blockNumber: bigint, timestamp: bigint): Promise<void> {
    if (this.#processing) {
      this.log.debug(
        `skipping block ${blockNumber}, still processing block ${this.#processing}`,
      );
      return;
    }
    try {
      this.#processing = blockNumber;
      await this.oracle.update(blockNumber);
      await this.#updateAccounts(blockNumber);
      this.#lastUpdated = blockNumber;
      this.#lastTimestamp = timestamp;
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
   * @param atBlock Fiex block for archive node which is needed to get data
   */
  async #updateAccounts(atBlock?: bigint): Promise<void> {
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
      let redstoneUpdates = await this.redstone.updatesForTokens(
        failedTokens,
        true,
      );
      // for data compressor we need only main price feeds
      redstoneUpdates = redstoneUpdates.filter(u => !u.reserve);

      const redstoneTokens = redstoneUpdates.map(({ token }) => token);
      this.log.debug(
        `got ${redstoneTokens.length} redstone price updates${blockS}: ${printTokens(redstoneTokens)}`,
      );
      [accounts, failedTokens] = await this.#potentialLiquidations(
        redstoneUpdates,
        atBlock,
      );
    }
    accounts = accounts.sort((a, b) => Number(a.healthFactor - b.healthFactor));
    if (this.config.restakingWorkaround) {
      const before = accounts.length;
      accounts = this.#filterRestakingAccounts(accounts);
      this.log.debug(
        `filtered out ${before - accounts.length} restaking accounts`,
      );
    }
    if (this.config.ignoreAccounts) {
      const before = accounts.length;
      const ignoreAccounts = new Set(
        this.config.ignoreAccounts?.map(a => a.toLowerCase()),
      );
      accounts = accounts.filter(
        ca => !ignoreAccounts.has(ca.addr.toLowerCase()),
      );
      this.log.debug(
        `filtered out ${before - accounts.length} ignored accounts`,
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
      await this.liquidatorService.liquidateOptimistic(accounts);
    } else {
      await this.liquidatorService.liquidate(accounts);
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
    priceUpdates: PriceOnDemandExtras[],
    blockNumber?: bigint,
  ): Promise<[accounts: CreditAccountData[], failedTokens: Address[]]> {
    const { optimistic, debugAccounts, debugManagers } = this.config;
    // during partial + optimistic liquidation, liquidation condition is not created externally.
    // it's created by liquidator itself before the liquidation.
    const liquidatableOnly = !optimistic || !this.config.isPartial;

    const selection: AccountSelection = {
      liquidatableOnly,
      priceUpdates,
      blockNumber: blockNumber ? BigInt(blockNumber) : undefined,
    };

    let accountsRaw: CreditAccountDataRaw[] = [];

    if (debugAccounts?.length) {
      accountsRaw = await this.#getParticularAccounts(debugAccounts, selection);
    } else if (debugManagers?.length) {
      accountsRaw = await this.#getAccountsFromManagers(
        debugManagers as Address[],
        selection,
      );
    } else {
      try {
        accountsRaw = await this.#getAllAccounts(selection);
      } catch (e) {
        const decoded = await this.errorHandler.explain(e, undefined, true);
        this.log.error(
          `get all accounts failed with trace: ${decoded.traceFile}`,
        );
        throw e;
      }
    }
    let accounts = accountsRaw.map(a => new CreditAccountData(a));

    accounts = accounts.filter(ca => {
      const ok = ca.healthFactor < this.config.hfThreshold;
      // Currently in data compressor helathFactor is set to type(uint16).max for zero-debt accounts
      // TODO: this will be changed to type(uint256).max in 3.1
      // 65535 is zero-debt account, no need to warn about it
      if (!ok && ca.healthFactor !== 65535n) {
        this.log.warn(
          `health factor of ${ca.name} ${ca.healthFactor} > ${this.config.hfThreshold} threshold, skipping`,
        );
      }
      return ok;
    });
    const failedTokens = new Set<Address>();
    for (const acc of accounts) {
      acc.priceFeedsNeeded.forEach(t => failedTokens.add(t));
    }

    return [accounts, Array.from(failedTokens)];
  }

  async #getParticularAccounts(
    accs: string[],
    { liquidatableOnly, priceUpdates, blockNumber }: AccountSelection,
  ): Promise<CreditAccountDataRaw[]> {
    const result: CreditAccountDataRaw[] = [];
    for (const acc of accs) {
      const { result: accData } =
        await this.dataCompressor.simulate.getCreditAccountData(
          [acc as Address, priceUpdates],
          { blockNumber },
        );
      result.push(accData);
    }
    return liquidatableOnly
      ? this.#filterLiquidatable(result, priceUpdates, blockNumber)
      : this.#filterZeroDebt(result);
  }

  // TODO: this can be nicely solved by exposing _queryCreditAccounts in DataCompressor
  async #getAllAccounts(
    selection: AccountSelection,
  ): Promise<CreditAccountDataRaw[]> {
    const { liquidatableOnly, priceUpdates, blockNumber } = selection;
    const blockS = blockNumber ? ` in ${blockNumber}` : "";
    try {
      if (liquidatableOnly) {
        this.log.debug(
          `getting liquidatable credit accounts${blockS} with ${priceUpdates.length} price updates...`,
        );
        const start = new Date().getTime();
        // getLiquidatableCreditAccounts does not support priceUpdates on main price feeds
        const { result } =
          await this.dataCompressor.simulate.getLiquidatableCreditAccounts(
            [priceUpdates],
            { blockNumber, gas: 550_000_000n },
          );
        const duration = Math.round((new Date().getTime() - start) / 1000);
        this.log.debug(
          { duration: `${duration}s`, count: result.length },
          `getLiquidatableCreditAccounts`,
        );
        return [...result];
      }
    } catch (e) {
      this.log.error(`failed to call getLiquidatableCreditAccounts: ${e}`);
      // been revering with EVM error MemoryOOG lately
      // fallback to getCreditManagersV3List below
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
    selection: AccountSelection,
  ): Promise<CreditAccountDataRaw[]> {
    const { liquidatableOnly, blockNumber, priceUpdates } = selection;
    const accs: CreditAccountDataRaw[] = [];
    // do not use Promise.all, because it crashes anvil
    for (const cm of cms) {
      const accsFromCM = await this.#getAccountsFromManager2(cm, selection);
      accs.push(...accsFromCM);
    }
    this.log.debug(
      `loaded ${accs.length} credit accounts from ${cms.length} credit managers`,
    );
    return liquidatableOnly
      ? this.#filterLiquidatable(accs, priceUpdates, blockNumber)
      : this.#filterZeroDebt(accs);
  }

  // async #getAccountsFromManager(
  //   cm: Address,
  //   { priceUpdates, blockNumber }: AccountSelection,
  // ): Promise<CreditAccountDataRaw[]> {
  //   const { result } =
  //     await this.dataCompressor.simulate.getCreditAccountsByCreditManager(
  //       [cm, priceUpdates],
  //       { blockNumber, gas: 550_000_000n },
  //     );
  //   this.log.debug(`${result.length} accounts loaded from ${cm}`);
  //   return [...result];
  // }

  async #getAccountsFromManager2(
    cm: Address,
    { priceUpdates, blockNumber }: AccountSelection,
    pageSize = 30,
  ): Promise<CreditAccountDataRaw[]> {
    const accAddrs = await this.client.pub.readContract({
      address: cm,
      abi: iCreditManagerV3Abi,
      functionName: "creditAccounts",
      args: [],
    });
    this.log.debug(`found ${accAddrs.length} accounts in ${cm}`);
    // paginate via accAddrs and getCreditAccountData with multicall
    const result: CreditAccountDataRaw[] = [];
    for (let i = 0; i < accAddrs.length; i += pageSize) {
      const page = accAddrs.slice(i, i + pageSize);
      const resp = await simulateMulticall(this.client.pub, {
        contracts: [
          ...this.redstone.toDirectMulticallUpdates(priceUpdates),
          ...page.map(acc => ({
            address: this.dataCompressor.address,
            abi: iDataCompressorV3Abi,
            functionName: "getCreditAccountData",
            args: [acc, priceUpdates],
          })),
        ],
        blockNumber,
        allowFailure: false,
        gas: 550_000_000n,
        batchSize: 0,
      });
      result.push(
        ...(resp.slice(priceUpdates.length) as CreditAccountDataRaw[]),
      );
      this.log.debug(
        `loaded page ${i + 1} of ${accAddrs.length} accounts from ${cm}`,
      );
    }
    return result;
  }

  #filterZeroDebt(accs: CreditAccountDataRaw[]): CreditAccountDataRaw[] {
    return accs.filter(acc => acc.debt > 0n);
  }

  async #filterLiquidatable(
    accs: CreditAccountDataRaw[],
    priceUpdates: PriceOnDemandExtras[],
    blockNumber?: bigint,
  ): Promise<CreditAccountDataRaw[]> {
    this.log.debug(
      `filtering liquidatable credit accounts from selection of ${accs.length}...`,
    );

    let mc = await simulateMulticall(this.client.pub, {
      blockNumber,
      allowFailure: true,
      batchSize: 0,
      gas: 550_000_000n,
      contracts: [
        ...this.redstone.toDirectMulticallUpdates(priceUpdates),
        ...accs.map(
          ({ addr, creditManager }) =>
            ({
              address: creditManager as Address,
              abi: iCreditManagerV3Abi,
              functionName: "isLiquidatable",
              args: [addr as Address, PERCENTAGE_FACTOR],
            }) as const,
        ),
      ],
    });
    for (let i = 0; i < priceUpdates.length; i++) {
      const pu = priceUpdates[i];
      if (mc[i].status === "failure") {
        this.log.warn(
          `price update of ${pu.dataFeedId} feed at ${pu.address} failed: ${mc[i].error}`,
        );
      }
    }
    mc = mc.slice(priceUpdates.length);
    const results: CreditAccountDataRaw[] = [];
    for (let i = 0; i < accs.length; i++) {
      const acc = accs[i];
      const { status, error, result } = mc[i];
      if (status === "failure") {
        const errMsg =
          error instanceof BaseError ? error.shortMessage : error.message;
        this.log.warn(
          { account: acc.addr, priceFeedsNeeded: acc.priceFeedsNeeded },
          `isLiquidatable reverted: ${errMsg}`,
        );
        results.push(acc);
      } else if (result) {
        results.push(acc);
      }
    }
    this.log.debug(
      `${results.length}/${accs.length} accounts are liquidatable`,
    );
    return results;
  }

  async #setupRestakingWorkaround(): Promise<void> {
    this.#restakingCMAddr = RESTAKING_CMS[this.config.network];

    if (this.#restakingCMAddr) {
      const cm = getContract({
        abi: iCreditManagerV3Abi,
        address: this.#restakingCMAddr,
        client: this.client.pub,
      });
      const [[, , liquidationDiscount], ezETHLT] = await Promise.all([
        cm.read.fees(),
        cm.read.liquidationThresholds([
          tokenDataByNetwork[this.config.network].ezETH,
        ]),
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
            `filtered out ${ca.addr} due to restaking workaround (HF ${ca.healthFactor} < ${this.#restakingMinHF})`,
          );
        }
        return ok;
      }
      return true;
    });
  }

  private get dataCompressor(): IDataCompressorContract {
    if (!this.#dataCompressor) {
      throw new Error("data compressor not initialized");
    }
    return this.#dataCompressor;
  }

  protected get errorHandler(): ErrorHandler {
    if (!this.#errorHandler) {
      throw new Error("error handler not initialized");
    }
    return this.#errorHandler;
  }

  public get lastUpdated(): bigint {
    return this.#lastUpdated;
  }

  public get lastTimestamp(): bigint {
    return this.#lastTimestamp;
  }
}

function printTokens(tokens: Address[]): string {
  return tokens.map(getTokenSymbolOrTicker).join(", ");
}
