import {
  aaveFlTakerAbi,
  iLiquidatorAbi,
  iPriceHelperAbi,
  liquidatorAbi,
  priceHelperAbi,
} from "@gearbox-protocol/liquidator-v2-contracts/abi";
import {
  AaveFLTaker_bytecode,
  Liquidator_bytecode,
  PriceHelper_bytecode,
} from "@gearbox-protocol/liquidator-v2-contracts/bytecode";
import type { ExcludeArrayProps } from "@gearbox-protocol/sdk-gov";
import {
  ADDRESS_0X0,
  contractsByNetwork,
  formatBN,
  getDecimals,
  PERCENTAGE_FACTOR,
  tokenSymbolByAddress,
  WAD,
} from "@gearbox-protocol/sdk-gov";
import {
  iaclAbi,
  iCreditConfiguratorV3Abi,
  iCreditManagerV3Abi,
  iExceptionsAbi,
} from "@gearbox-protocol/types/abi";
import { Service } from "typedi";
import type { Address, SimulateContractReturnType } from "viem";
import { getContract, parseEther } from "viem";

import type { CreditAccountData, CreditManagerData } from "../../data/index.js";
import { Logger, type LoggerInterface } from "../../log/index.js";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3.js";
import type {
  ILiquidationStrategy,
  MakeLiquidatableResult,
  PartialLiquidationPreview,
} from "./types.js";
import type { IPriceHelperContract, TokenPriceInfo } from "./viem-types.js";

interface TokenBalance extends ExcludeArrayProps<TokenPriceInfo> {
  /**
   * Balance in underlying * liquidationThreshold
   */
  weightedBalance: bigint;
}

@Service()
export default class LiquidationStrategyV3Partial
  extends AbstractLiquidationStrategyV3
  implements ILiquidationStrategy<PartialLiquidationPreview>
{
  public readonly name = "partial";
  public readonly adverb = "partially";

  @Logger("LiquidationStrategyV3Partial")
  logger: LoggerInterface;

  #partialLiquidator?: Address;
  #priceHelper?: IPriceHelperContract;
  #configuratorAddr?: Address;
  #registeredCMs: Record<Address, boolean> = {};

  public async launch(): Promise<void> {
    await super.launch();

    const router = await this.addressProvider.findService("ROUTER", 300);
    const bot = await this.addressProvider.findService(
      "PARTIAL_LIQUIDATION_BOT",
      300,
    );
    const aavePool =
      contractsByNetwork[this.config.network].AAVE_V3_LENDING_POOL;
    this.logger.debug(`router=${router}, bot=${bot}, aave pool = ${aavePool}`);

    this.#priceHelper = await this.#deployPriceHelper();
    this.#partialLiquidator = await this.#deployPartialLiquidator(
      router,
      bot,
      aavePool,
    );
    await this.#configurePartialLiquidator(router, bot);
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
    if (!this.#registeredCMs[ca.creditManager.toLowerCase() as Address]) {
      throw new Error(
        "warning: account's credit manager is not registered in partial liquidator",
      );
    }
    const logger = this.#caLogger(ca);
    const cm = await this.getCreditManagerData(ca.creditManager);

    const ltChanges = await this.#calcNewLTs(ca);
    const snapshotId = await this.client.anvil.snapshot();

    await this.#setNewLTs(ca, cm, ltChanges);
    const updCa = await this.updateCreditAccountData(ca);
    logger.debug({
      hfNew: updCa.healthFactor.toString(),
      hfOld: ca.healthFactor.toString(),
      isSuccessful: updCa.isSuccessful,
    });
    return {
      snapshotId,
      partialLiquidationCondition: {
        hfNew: Number(updCa.healthFactor),
        ltChanges,
      },
    };
  }

  public async preview(
    ca: CreditAccountData,
  ): Promise<PartialLiquidationPreview> {
    const logger = this.#caLogger(ca);
    const cm = await this.getCreditManagerData(ca.creditManager);
    const priceUpdates = await this.redstone.liquidationPreviewUpdates(ca);
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
      abi: [...iLiquidatorAbi, ...iExceptionsAbi],
      address: this.partialLiquidator,
      functionName: "getOptimalLiquidation",
      args: [ca.addr, 10100n, priceUpdates as any],
    });
    const [symb, decimals, uSymb, uDec] = [
      tokenSymbolByAddress[tokenOut.toLowerCase()],
      getDecimals(tokenOut),
      tokenSymbolByAddress[cm.underlyingToken.toLowerCase()],
      getDecimals(cm.underlyingToken),
    ];
    logger.debug(
      {
        tokenOut: `${symb} (${tokenOut})`,
        optimalAmount:
          formatBN(optimalAmount, decimals) + ` ${symb} (${optimalAmount})`,
        flashLoanAmount:
          formatBN(flashLoanAmount, uDec) + ` ${uSymb} (${flashLoanAmount})`,
        repaidAmount:
          formatBN(repaidAmount, uDec) + ` ${uSymb} (${repaidAmount})`,
        isOptimalRepayable,
      },
      "found optimal liquidation",
    );
    const connectors = this.pathFinder.getAvailableConnectors(ca.allBalances);

    const { result: preview } = await this.client.pub.simulateContract({
      account: this.client.account,
      address: this.partialLiquidator,
      abi: [...iLiquidatorAbi, ...iExceptionsAbi],
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
    };
  }

  public async simulate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<SimulateContractReturnType> {
    return this.client.pub.simulateContract({
      account: this.client.account,
      address: this.partialLiquidator,
      abi: [...iLiquidatorAbi, ...iExceptionsAbi],
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
    const tokens = await this.priceHelper.simulate.previewTokens([
      ca.addr,
      priceUpdates,
    ]);
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
  ): Promise<Record<string, [ltOld: bigint, ltNew: bigint]>> {
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

    const result: Record<string, [bigint, bigint]> = {};
    const ltChangesHuman: Record<string, string> = {};
    for (const { token, liquidationThreshold: oldLT } of balances) {
      if (token !== ca.underlyingToken) {
        const newLT = (oldLT * k) / WAD;
        result[token] = [oldLT, newLT];
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
    ltChanges: Record<Address, [bigint, bigint]>,
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
        args: [t as Address, Number(lt)],
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

  async #deployPartialLiquidator(
    router: Address,
    bot: Address,
    aavePool: Address,
  ): Promise<Address> {
    let partialLiquidatorAddress = this.config.partialLiquidatorAddress;
    if (!partialLiquidatorAddress) {
      this.logger.debug("deploying partial liquidator");

      let hash = await this.client.wallet.deployContract({
        abi: aaveFlTakerAbi,
        bytecode: AaveFLTaker_bytecode,
        args: [aavePool],
      });
      this.logger.debug(`waiting for AaveFLTaker to deploy, tx hash: ${hash}`);
      const { contractAddress: aaveFlTakerAddr } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!aaveFlTakerAddr) {
        throw new Error(`AaveFLTaker was not deployed, tx hash: ${hash}`);
      }
      let owner = await this.client.pub.readContract({
        abi: aaveFlTakerAbi,
        functionName: "owner",
        address: aaveFlTakerAddr,
      });
      this.logger.debug(
        `deployed AaveFLTaker at ${aaveFlTakerAddr} owned by ${owner} in tx ${hash}`,
      );

      hash = await this.client.wallet.deployContract({
        abi: liquidatorAbi,
        bytecode: Liquidator_bytecode,
        args: [router, bot, aavePool, aaveFlTakerAddr],
      });
      this.logger.debug(`waiting for liquidator to deploy, tx hash: ${hash}`);
      const { contractAddress: liquidatorAddr } =
        await this.client.pub.waitForTransactionReceipt({
          hash,
          timeout: 120_000,
        });
      if (!liquidatorAddr) {
        throw new Error(`Liquidator was not deployed, tx hash: ${hash}`);
      }
      owner = await this.client.pub.readContract({
        abi: liquidatorAbi,
        address: liquidatorAddr,
        functionName: "owner",
      });
      this.logger.debug(
        `deployed Liquidator at ${liquidatorAddr} owned by ${owner} in tx ${hash}`,
      );

      const receipt = await this.client.simulateAndWrite({
        address: aaveFlTakerAddr,
        abi: aaveFlTakerAbi,
        functionName: "setAllowedFLReceiver",
        args: [liquidatorAddr, true],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `AaveFLTaker.setAllowedFLReceiver reverted, tx hash: ${receipt.transactionHash}`,
        );
      }
      this.logger.debug(
        `set allowed flashloan receiver on FLTaker ${aaveFlTakerAddr} to ${liquidatorAddr} in tx ${receipt.transactionHash}`,
      );

      partialLiquidatorAddress = liquidatorAddr;
    }
    this.logger.info(
      `partial liquidator contract addesss: ${partialLiquidatorAddress}`,
    );
    return partialLiquidatorAddress;
  }

  async #deployPriceHelper(): Promise<IPriceHelperContract | undefined> {
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

    return getContract({
      abi: iPriceHelperAbi,
      address: priceHelperAddr,
      client: this.client.pub,
    });
  }

  async #configurePartialLiquidator(
    router: Address,
    bot: Address,
  ): Promise<void> {
    const [currentRouter, currentBot, cms] = await Promise.all([
      this.client.pub.readContract({
        abi: iLiquidatorAbi,
        address: this.partialLiquidator,
        functionName: "router",
      }),
      this.client.pub.readContract({
        abi: iLiquidatorAbi,
        address: this.partialLiquidator,
        functionName: "partialLiquidationBot",
      }),
      this.getCreditManagersV3List(),
    ]);

    if (router.toLowerCase() !== currentRouter.toLowerCase()) {
      this.logger.warn(
        `need to update router from ${currentRouter} to ${router}`,
      );
      const receipt = await this.client.simulateAndWrite({
        abi: iLiquidatorAbi,
        address: this.partialLiquidator,
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

    if (bot.toLowerCase() !== currentBot.toLowerCase()) {
      this.logger.warn(`need to update bot from ${currentBot} to ${bot}`);
      const receipt = await this.client.simulateAndWrite({
        abi: iLiquidatorAbi,
        address: this.partialLiquidator,
        functionName: "setPartialLiquidationBot",
        args: [bot],
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `PartialLiquidator.setPartialLiquidationBot(${bot}) tx ${receipt.transactionHash} reverted`,
        );
      }
      this.logger.info(`set bot to ${bot} in tx ${receipt.transactionHash}`);
    }
    const cmToCa = await this.#getLiquidatorAccounts(cms);
    for (const cm of cms) {
      const { address, name } = cm;
      const ca = cmToCa[address];
      if (ca === ADDRESS_0X0) {
        await this.#registerCM(cm);
      } else {
        this.logger.debug(
          `credit manager ${name} (${address}) already registered with account ${ca}`,
        );
        this.#registeredCMs[address.toLowerCase() as Address] = true;
      }
    }
  }

  async #getLiquidatorAccounts(
    cms: CreditManagerData[],
  ): Promise<Record<Address, Address>> {
    const results = await this.client.pub.multicall({
      allowFailure: false,
      contracts: cms.map(cm => ({
        abi: iLiquidatorAbi,
        address: this.partialLiquidator,
        functionName: "cmToCA",
        args: [cm.address],
      })),
    });
    this.logger.debug(`loaded ${cms.length} liquidator credit accounts`);
    return Object.fromEntries(cms.map((cm, i) => [cm.address, results[i]]));
  }

  async #registerCM(cm: CreditManagerData): Promise<void> {
    const { address, name } = cm;
    try {
      this.logger.debug(`need to register credit manager ${name} (${address})`);
      const receipt = await this.client.simulateAndWrite({
        abi: iLiquidatorAbi,
        address: this.partialLiquidator,
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
      this.#registeredCMs[address.toLowerCase() as Address] = true;
    } catch (e) {
      this.logger.error(
        `failed to register credit manager ${name} (${address}): ${e}`,
      );
      this.#registeredCMs[address.toLowerCase() as Address] = false;
    }
  }

  #caLogger(ca: CreditAccountData): LoggerInterface {
    return this.logger.child({
      account: ca.addr,
      borrower: ca.borrower,
      manager: ca.managerName,
      hf: ca.healthFactor,
    });
  }

  private get partialLiquidator(): Address {
    if (!this.#partialLiquidator) {
      throw new Error("strategy not launched");
    }
    return this.#partialLiquidator;
  }

  private get priceHelper(): IPriceHelperContract {
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
      const aclAddr = await this.addressProvider.findService("ACL", 0);
      this.#configuratorAddr = await this.client.pub.readContract({
        address: aclAddr,
        abi: iaclAbi,
        functionName: "owner",
      });
      this.logger.debug(`configurator address: ${this.#configuratorAddr}`);
    }
    return this.#configuratorAddr;
  }
}
