import {
  iPartialLiquidatorAbi,
  iPriceHelperAbi,
  priceHelperAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import { PriceHelper_bytecode } from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import type { ExcludeArrayProps } from "@gearbox-protocol/sdk-gov";
import {
  formatBN,
  getDecimals,
  PERCENTAGE_FACTOR,
  tokenDataByNetwork,
  tokenSymbolByAddress,
  WAD,
} from "@gearbox-protocol/sdk-gov";
import {
  iaclAbi,
  iCreditConfiguratorV3Abi,
  iCreditManagerV3Abi,
} from "@gearbox-protocol/types/abi";
import type { Address, SimulateContractReturnType } from "viem";
import { parseEther } from "viem";

import {
  type CreditAccountData,
  type CreditManagerData,
  exceptionsAbis,
} from "../../data/index.js";
import type { ILogger } from "../../log/index.js";
import AAVELiquidatorContract from "./AAVELiquidatorContract.js";
import GHOLiquidatorContract from "./GHOLiquidatorContract.js";
import type PartialLiquidatorContract from "./PartialLiquidatorContract.js";
import SiloLiquidatorContract from "./SiloLiquidatorContract.js";
import SingularFullLiquidator from "./SingularFullLiquidator.js";
import SingularLiquidator from "./SingularLiquidator.js";
import type {
  MakeLiquidatableResult,
  PartialLiquidationPreview,
  PartialLiquidationPreviewWithFallback,
} from "./types.js";
import type { TokenPriceInfo } from "./viem-types.js";

interface TokenBalance extends ExcludeArrayProps<TokenPriceInfo> {
  /**
   * Balance in underlying * liquidationThreshold
   */
  weightedBalance: bigint;
}

export default class SingularPartialLiquidator extends SingularLiquidator<PartialLiquidationPreviewWithFallback> {
  protected readonly name = "partial";
  protected readonly adverb = "partially";

  #priceHelper?: Address;
  #configuratorAddr?: Address;
  /**
   * mapping of credit manager address to deployed partial liquidator
   */
  #liquidatorForCM: Record<Address, PartialLiquidatorContract> = {};
  #fallback?: SingularFullLiquidator;

  public async launch(asFallback?: boolean): Promise<void> {
    await super.launch(asFallback);

    if (this.config.partialFallback && !asFallback) {
      this.#fallback = new SingularFullLiquidator();
      this.logger.debug("launching full liquidator as fallback");
      await this.#fallback.launch(true);
    }

    const router = this.addressProvider.findService("ROUTER", 300);
    const bot = this.addressProvider.findService(
      "PARTIAL_LIQUIDATION_BOT",
      300,
    );

    await this.#deployPriceHelper();
    const cms = await this.getCreditManagersV3List();
    let liquidatorContracts: PartialLiquidatorContract[] = [];
    if (this.config.network === "Sonic") {
      liquidatorContracts = await this.#getSonicContracts(cms, router, bot);
    } else {
      liquidatorContracts = await this.#getDefaultContracts(cms, router, bot);
    }

    let expectedEnv: Record<string, string> = {};
    for (const contract of liquidatorContracts) {
      if (!contract.isSupported) {
        this.logger.info(
          `${contract.name} is not supported on ${this.config.network}`,
        );
        continue;
      }
      await contract.deploy();
      await contract.configure();
      expectedEnv = {
        ...expectedEnv,
        ...Object.fromEntries([contract.envVariable]),
      };
    }
    this.logger.info(expectedEnv, "expected env");
  }

  async #getDefaultContracts(
    cms: CreditManagerData[],
    router: Address,
    bot: Address,
  ): Promise<PartialLiquidatorContract[]> {
    const aaveLiquidator = new AAVELiquidatorContract(router, bot);
    const ghoLiquidator = new GHOLiquidatorContract(router, bot, "GHO");
    const dolaLiquidator = new GHOLiquidatorContract(router, bot, "DOLA");
    const GHO = tokenDataByNetwork[this.config.network].GHO.toLowerCase();
    const DOLA = tokenDataByNetwork[this.config.network].DOLA.toLowerCase();

    for (const cm of cms) {
      switch (cm.underlyingToken) {
        case GHO: {
          ghoLiquidator.addCreditManager(cm);
          this.#liquidatorForCM[cm.address] = ghoLiquidator;
          break;
        }
        case DOLA: {
          dolaLiquidator.addCreditManager(cm);
          this.#liquidatorForCM[cm.address] = dolaLiquidator;
          break;
        }
        default: {
          aaveLiquidator.addCreditManager(cm);
          this.#liquidatorForCM[cm.address] = aaveLiquidator;
        }
      }
    }
    return [aaveLiquidator, ghoLiquidator, dolaLiquidator];
  }

  async #getSonicContracts(
    cms: CreditManagerData[],
    router: Address,
    bot: Address,
  ): Promise<PartialLiquidatorContract[]> {
    const siloLiquidator = new SiloLiquidatorContract(router, bot);
    for (const cm of cms) {
      siloLiquidator.addCreditManager(cm);
      this.#liquidatorForCM[cm.address] = siloLiquidator;
    }
    return [siloLiquidator];
  }

  public async makeLiquidatable(
    ca: CreditAccountData,
  ): Promise<MakeLiquidatableResult> {
    if (!this.config.optimistic) {
      throw new Error("makeLiquidatable only works in optimistic mode");
    }
    if (ca.borrowedAmount === 0n) {
      throw new Error("warning: zero-debt account");
    }
    if (!this.oracle.checkReserveFeeds(ca)) {
      throw new Error(
        "warning: account has tokens without reserve price feeds",
      );
    }
    if (!this.liquidatorForCA(ca)) {
      throw new Error(
        "warning: account's credit manager is not registered in partial liquidator",
      );
    }
    const logger = this.#caLogger(ca);
    const cm = await this.getCreditManagerData(ca.creditManager);

    const ltChanges = await this.#calcNewLTs(ca);
    const snapshotId = await this.client.anvil.snapshot();

    await this.#setNewLTs(ca, cm, ltChanges);
    let hfNew = 0;
    try {
      // this currently reverts when price updates contain reserve = true updates
      const updCa = await this.updateCreditAccountData(ca);
      logger.debug({
        hfNew: updCa.healthFactor.toString(),
        hfOld: ca.healthFactor.toString(),
        isSuccessful: updCa.isSuccessful,
      });
      hfNew = Number(updCa.healthFactor);
    } catch (e) {
      logger.warn(e);
    }
    return {
      snapshotId,
      partialLiquidationCondition: {
        hfNew,
        ltChanges,
      },
    };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PartialLiquidationPreviewWithFallback> {
    const logger = this.#caLogger(ca);
    try {
      const partial = await this.#preview(ca);
      return {
        ...partial,
        fallback: false,
      };
    } catch (e) {
      if (this.#fallback) {
        logger.warn(
          `partial liquidation failed, falling back to full liquidation: ${e}`,
        );
        const result = await this.#fallback.preview(ca);
        return {
          ...result,
          fallback: true,
        };
      }
      throw e;
    }
  }

  async #preview(ca: CreditAccountData): Promise<PartialLiquidationPreview> {
    const logger = this.#caLogger(ca);
    const cm = await this.getCreditManagerData(ca.creditManager);
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(ca);
    const liquidatorAddr = this.liquidatorForCA(ca);
    if (!liquidatorAddr) {
      throw new Error(
        `no partial liquidator contract found for account ${ca.addr} in ${ca.cmName}`,
      );
    }
    const {
      result: [
        tokenOut,
        optimalAmount,
        repaidAmount,
        flashLoanAmount,
        isOptimalRepayable,
      ],
    } = await this.client.pub.simulateContract({
      account: this.client.account,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      address: liquidatorAddr,
      functionName: "getOptimalLiquidation",
      args: [ca.addr, 10100n, priceUpdates as any],
    });
    const [symb, decimals, uSymb, uDec] = [
      tokenSymbolByAddress[tokenOut.toLowerCase()],
      getDecimals(tokenOut),
      tokenSymbolByAddress[cm.underlyingToken.toLowerCase()],
      getDecimals(cm.underlyingToken),
    ];
    const connectors = this.pathFinder.getAvailableConnectors(
      cm.collateralTokens,
    );

    try {
      logger.debug(
        {
          tokenOut: `${symb} (${tokenOut})`,
          optimalAmount:
            formatBN(optimalAmount, decimals) + ` ${symb} (${optimalAmount})`,
          flashLoanAmount:
            formatBN(flashLoanAmount, uDec) + ` ${uSymb} (${flashLoanAmount})`,
          repaidAmount:
            formatBN(repaidAmount, uDec) + ` ${uSymb} (${repaidAmount})`,
          priceUpdates: priceUpdates.map(p => p.token),
          connectors,
          slippage: this.config.slippage.toString(),
          isOptimalRepayable,
        },
        "calling previewPartialLiquidation",
      );
      const { result: preview } = await this.client.pub.simulateContract({
        account: "0x0000000000000000000000000000000000000000",
        address: liquidatorAddr,
        abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
        functionName: "previewPartialLiquidation",
        args: [
          ca.creditManager,
          ca.addr,
          tokenOut,
          optimalAmount,
          flashLoanAmount,
          priceUpdates as any,
          connectors,
          BigInt(this.config.slippage),
        ],
      });
      if (preview.profit < 0n) {
        if (isOptimalRepayable) {
          throw new Error("optimal liquidation is not profitable or errored");
        } else {
          throw new Error(
            "warning: cannot liquidate while remaining within borrowing limits",
          );
        }
      }
      return {
        assetOut: tokenOut as Address,
        amountOut: optimalAmount,
        flashLoanAmount,
        priceUpdates,
        calls: preview.calls.map(c => ({
          callData: c.callData,
          target: c.target,
        })),
        underlyingBalance: preview.profit,
        skipOnFailure: !isOptimalRepayable,
      };
    } catch (e) {
      if (!isOptimalRepayable) {
        throw new Error(`warning: ${e}`);
      }
      throw e;
    }
  }

  public async simulate(
    account: CreditAccountData,
    preview: PartialLiquidationPreviewWithFallback,
  ): Promise<SimulateContractReturnType> {
    const logger = this.#caLogger(account);
    if (preview.fallback) {
      if (!this.#fallback) {
        throw new Error("fallback liquidator is not launched");
      }
      logger.debug("simulating with fallback liquidator");
      return this.#fallback.simulate(account, preview);
    }
    return this.#simulate(account, preview);
  }

  async #simulate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType> {
    const liquidatorAddr = this.liquidatorForCA(account);
    if (!liquidatorAddr) {
      throw new Error(
        `no partial liquidator contract found for account ${account.addr} in ${account.cmName}`,
      );
    }
    return this.client.pub.simulateContract({
      account: this.client.account,
      address: liquidatorAddr,
      abi: [...iPartialLiquidatorAbi, ...exceptionsAbis],
      functionName: "partialLiquidateAndConvert",
      args: [
        account.creditManager,
        account.addr,
        preview.assetOut,
        preview.amountOut,
        preview.flashLoanAmount,
        preview.priceUpdates,
        preview.calls,
      ],
    });
  }

  async #prepareAccountTokens(ca: CreditAccountData): Promise<TokenBalance[]> {
    const priceUpdates = await this.redstone.dataCompressorUpdates(ca);
    // this helper contract fetches prices while trying to ignore failed price feeds
    // prices here are not critical, as they're used for sorting and estimation and only in optimistic mode
    const tokens = await this.client.pub.simulateContract({
      address: this.priceHelper,
      abi: [...iPriceHelperAbi, ...exceptionsAbis],
      functionName: "previewTokens",
      args: [ca.addr, priceUpdates],
    });
    // Sort by weighted value descending, but underlying token comes last
    return tokens.result
      .map(
        (t): TokenBalance => ({
          token: t.token.toLowerCase() as Address,
          balance: t.balance,
          balanceInUnderlying: t.balanceInUnderlying,
          liquidationThreshold: t.liquidationThreshold,
          weightedBalance:
            (t.balanceInUnderlying * t.liquidationThreshold) /
            PERCENTAGE_FACTOR,
        }),
      )
      .sort((a, b) => {
        if (a.token === ca.underlyingToken) return 1;
        if (b.token === ca.underlyingToken) return -1;
        return b.weightedBalance > a.weightedBalance ? 1 : -1;
      });
  }

  /**
   * Given credit accounts, calculates new liquidation thresholds that needs to be set to drop account health factor a bit to make it eligible for partial liquidation
   * @param ca
   */
  async #calcNewLTs(
    ca: CreditAccountData,
    factor = 9990n,
  ): Promise<Record<Address, [ltOld: number, ltNew: number]>> {
    const logger = this.#caLogger(ca);
    const balances = await this.#prepareAccountTokens(ca);
    balances.forEach(b => {
      logger.debug(
        `${tokenSymbolByAddress[b.token]}: ${formatBN(b.balance, getDecimals(b.token))} ${tokenSymbolByAddress[b.token]} == ${formatBN(b.balanceInUnderlying, getDecimals(ca.underlyingToken))} (weighted ${formatBN(b.weightedBalance, getDecimals(ca.underlyingToken))}) ${tokenSymbolByAddress[ca.underlyingToken]}`,
      );
    });
    // const snapshotId = await (
    // this.executor.provider as providers.JsonRpcProvider
    // ).send("evm_snapshot", []);

    // LTnew = LT * k, where
    //
    //        totalDebt - B_underlying * LT_underlying
    // k = -------------------------------------------------------------
    //                    sum(p * b* LT)
    let divisor = 0n;
    let dividend =
      (factor * ca.borrowedAmountPlusInterestAndFees) / PERCENTAGE_FACTOR; // TODO: USDT fee
    for (const { token, weightedBalance } of balances) {
      if (token === ca.underlyingToken) {
        dividend -= weightedBalance;
      } else {
        divisor += weightedBalance;
      }
    }
    if (divisor === 0n) {
      throw new Error("warning: assets have zero weighted value in underlying");
    }
    if (dividend <= 0n) {
      throw new Error(`warning: account balance in underlying covers debt`);
    }
    const k = (WAD * dividend) / divisor;

    const result: Record<Address, [number, number]> = {};
    const ltChangesHuman: Record<string, string> = {};
    for (const { token, liquidationThreshold: oldLT } of balances) {
      if (token !== ca.underlyingToken) {
        const newLT = (oldLT * k) / WAD;
        result[token] = [Number(oldLT), Number(newLT)];
        ltChangesHuman[tokenSymbolByAddress[token]] = `${oldLT} => ${newLT}`;
      }
    }
    logger.debug(
      ltChangesHuman,
      "need to change LTs to enable partial liquidation",
    );
    return result;
  }

  async #setNewLTs(
    ca: CreditAccountData,
    cm: CreditManagerData,
    ltChanges: Record<Address, [number, number]>,
  ): Promise<void> {
    const logger = this.#caLogger(ca);
    const configuratorAddr = await this.getConfiguratorAddr();
    await this.client.anvil.impersonateAccount({
      address: configuratorAddr,
    });
    await this.client.anvil.setBalance({
      address: configuratorAddr,
      value: parseEther("100"),
    });
    for (const [t, [_, lt]] of Object.entries(ltChanges)) {
      await this.client.simulateAndWrite({
        address: cm.creditConfigurator,
        account: configuratorAddr,
        abi: iCreditConfiguratorV3Abi,
        functionName: "setLiquidationThreshold",
        args: [t as Address, lt],
      });
      const newLT = await this.client.pub.readContract({
        address: cm.address,
        abi: iCreditManagerV3Abi,
        functionName: "liquidationThresholds",
        args: [t as Address],
      });
      logger.debug(`set LT of ${tokenSymbolByAddress[t]} to ${lt}: ${newLT}`);
    }
    await this.client.anvil.stopImpersonatingAccount({
      address: configuratorAddr,
    });
  }

  async #deployPriceHelper(): Promise<void> {
    if (!this.config.optimistic) {
      return undefined;
    }
    this.logger.debug("deploying price helper");

    const hash = await this.client.wallet.deployContract({
      abi: priceHelperAbi,
      bytecode: PriceHelper_bytecode,
      args: [],
    });
    this.logger.debug(`waiting for PriceHelper to deploy, tx hash: ${hash}`);
    const { contractAddress: priceHelperAddr } =
      await this.client.pub.waitForTransactionReceipt({
        hash,
        timeout: 120_000,
      });
    if (!priceHelperAddr) {
      throw new Error(`PriceHelper was not deployed, tx hash: ${hash}`);
    }
    this.logger.debug(
      `deployed PriceHelper at ${priceHelperAddr} in tx ${hash}`,
    );
    this.#priceHelper = priceHelperAddr;
  }

  #caLogger(ca: CreditAccountData): ILogger {
    return this.logger.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: ca.managerName,
      hf: ca.healthFactor,
    });
  }

  private get priceHelper(): Address {
    if (!this.config.optimistic) {
      throw new Error("price helper is only available in optimistic mode");
    }
    if (!this.#priceHelper) {
      throw new Error("strategy not launched");
    }
    return this.#priceHelper;
  }

  private async getConfiguratorAddr(): Promise<Address> {
    if (!this.#configuratorAddr) {
      const aclAddr = this.addressProvider.findService("ACL");
      this.#configuratorAddr = await this.client.pub.readContract({
        address: aclAddr,
        abi: iaclAbi,
        functionName: "owner",
      });
      this.logger.debug(`configurator address: ${this.#configuratorAddr}`);
    }
    return this.#configuratorAddr;
  }

  /**
   * Depending on credit manager underlying token, different partial liquidator contract should be used
   * @param ca
   * @returns
   */
  private liquidatorForCA(ca: CreditAccountData): Address | undefined {
    const contract = this.#liquidatorForCM[ca.creditManager];
    return contract?.address;
  }
}
