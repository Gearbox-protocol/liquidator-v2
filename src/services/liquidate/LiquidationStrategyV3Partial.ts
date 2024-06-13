import type { TokenPriceInfoStructOutput } from "@gearbox-protocol/liquidator-v2-contracts";
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
} from "@gearbox-protocol/types/abi";
import type { JsonRpcProvider, TransactionReceipt } from "ethers";
import { Service } from "typedi";
import type { Address } from "viem";
import { createTestClient, custom, getContract } from "viem";

import { Logger, type LoggerInterface } from "../../log/index.js";
import type { CreditAccountData } from "../../utils/ethers-6-temp/index.js";
import type { CreditManagerData } from "../../utils/index.js";
import AbstractLiquidationStrategyV3 from "./AbstractLiquidationStrategyV3.js";
import type {
  ILiquidationStrategy,
  MakeLiquidatableResult,
  PartialLiquidationPreview,
} from "./types.js";
import type {
  ILiquidatorContract,
  IPriceHelperContract,
} from "./viem-types.js";

interface TokenBalance extends ExcludeArrayProps<TokenPriceInfoStructOutput> {
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

  #partialLiquidator?: ILiquidatorContract;
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
    const snapshotId = await (this.executor.provider as JsonRpcProvider).send(
      "evm_snapshot",
      [],
    );

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
    } = await this.partialLiquidator.simulate.getOptimalLiquidation([
      ca.addr,
      10100n,
      priceUpdates,
    ]);
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

    const { result: preview } =
      await this.partialLiquidator.simulate.previewPartialLiquidation([
        ca.creditManager,
        ca.addr,
        tokenOut,
        optimalAmount,
        flashLoanAmount,
        priceUpdates,
        connectors as any,
        BigInt(this.config.slippage),
      ]);
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

  public async estimate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
  ): Promise<bigint> {
    return this.partialLiquidator.estimateGas.partialLiquidateAndConvert(
      [
        account.creditManager,
        account.addr,
        preview.assetOut,
        preview.amountOut,
        preview.flashLoanAmount,
        preview.priceUpdates,
        preview.calls as any,
      ],
      {},
    );
  }

  public async liquidate(
    account: CreditAccountData,
    preview: PartialLiquidationPreview,
    gasLimit?: bigint,
  ): Promise<TransactionReceipt> {
    const { request } =
      await this.partialLiquidator.simulate.partialLiquidateAndConvert(
        [
          account.creditManager,
          account.addr,
          preview.assetOut,
          preview.amountOut,
          preview.flashLoanAmount,
          preview.priceUpdates,
          preview.calls as any,
        ],
        { gas: gasLimit },
      );
    // TODO: compatibility between ethers and viem
    return this.executor.sendPrivate(request as any);
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
          token: t.token.toLowerCase(),
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
    const anvilClient = createTestClient({
      transport: custom(this.publicClient.transport),
      mode: "anvil",
      chain: this.publicClient.chain,
    });
    const configuratorAddr = await this.getConfiguratorAddr();
    await anvilClient.impersonateAccount({ address: configuratorAddr });
    for (const [t, [_, lt]] of Object.entries(ltChanges)) {
      const hash = await this.executor.walletClient.writeContract({
        address: cm.creditConfigurator,
        account: configuratorAddr,
        abi: iCreditConfiguratorV3Abi,
        functionName: "setLiquidationThreshold",
        args: [t as Address, Number(lt)],
      });
      await this.publicClient.waitForTransactionReceipt({ hash });
      const newLT = await this.publicClient.readContract({
        address: cm.address,
        abi: iCreditManagerV3Abi,
        functionName: "liquidationThresholds",
        args: [t as Address],
      });
      logger.debug(`set LT of ${tokenSymbolByAddress[t]} to ${lt}: ${newLT}`);
    }
    await anvilClient.stopImpersonatingAccount({ address: configuratorAddr });
  }

  async #deployPartialLiquidator(
    router: Address,
    bot: Address,
    aavePool: Address,
  ): Promise<ILiquidatorContract> {
    let partialLiquidatorAddress = this.config.partialLiquidatorAddress;
    if (!partialLiquidatorAddress) {
      this.logger.debug("deploying partial liquidator");

      let hash = await this.executor.walletClient.deployContract({
        abi: aaveFlTakerAbi,
        bytecode: AaveFLTaker_bytecode,
        args: [aavePool],
      });
      this.logger.debug(`waiting for AaveFLTaker to deploy, tx hash: ${hash}`);
      const { contractAddress: aaveFlTakerAddr } =
        await this.publicClient.waitForTransactionReceipt({ hash });
      if (!aaveFlTakerAddr) {
        throw new Error(`AaveFLTaker was not deployed, tx hash: ${hash}`);
      }
      let owner = await this.publicClient.readContract({
        abi: aaveFlTakerAbi,
        functionName: "owner",
        address: aaveFlTakerAddr,
      });
      this.logger.debug(
        `deployed AaveFLTaker at ${aaveFlTakerAddr} owned by ${owner} in tx ${hash}`,
      );

      hash = await this.executor.walletClient.deployContract({
        abi: liquidatorAbi,
        bytecode: Liquidator_bytecode,
        args: [router, bot, aavePool, aaveFlTakerAddr],
      });
      this.logger.debug(`waiting for liquidator to deploy, tx hash: ${hash}`);
      const { contractAddress: liquidatorAddr } =
        await this.publicClient.waitForTransactionReceipt({ hash });
      if (!liquidatorAddr) {
        throw new Error(`Liquidator was not deployed, tx hash: ${hash}`);
      }
      owner = await this.publicClient.readContract({
        abi: liquidatorAbi,
        address: liquidatorAddr,
        functionName: "owner",
      });
      this.logger.debug(
        `deployed Liquidator at ${liquidatorAddr} owned by ${owner} in tx ${hash}`,
      );

      const { request } = await this.publicClient.simulateContract({
        account: this.executor.walletClient.account,
        address: aaveFlTakerAddr,
        abi: aaveFlTakerAbi,
        functionName: "setAllowedFLReceiver",
        args: [liquidatorAddr, true],
      });
      hash = await this.executor.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `AaveFLTaker.setAllowedFLReceiver reverted, tx hash: ${hash}`,
        );
      }
      this.logger.debug(
        `set allowed flashloan receiver on FLTaker ${aaveFlTakerAddr} to ${liquidatorAddr} in tx ${hash}`,
      );

      partialLiquidatorAddress = liquidatorAddr;
    }
    this.logger.info(
      `partial liquidator contract addesss: ${partialLiquidatorAddress}`,
    );
    return getContract({
      abi: iLiquidatorAbi,
      address: partialLiquidatorAddress,
      client: this.publicClient,
    });
  }

  async #deployPriceHelper(): Promise<IPriceHelperContract | undefined> {
    if (!this.config.optimistic) {
      return undefined;
    }
    this.logger.debug("deploying price helper");

    const hash = await this.executor.walletClient.deployContract({
      abi: priceHelperAbi,
      bytecode: PriceHelper_bytecode,
      args: [],
    });
    this.logger.debug(`waiting for PriceHelper to deploy, tx hash: ${hash}`);
    const { contractAddress: priceHelperAddr } =
      await this.publicClient.waitForTransactionReceipt({ hash });
    if (!priceHelperAddr) {
      throw new Error(`PriceHelper was not deployed, tx hash: ${hash}`);
    }
    this.logger.debug(
      `deployed PriceHelper at ${priceHelperAddr} in tx ${hash}`,
    );

    return getContract({
      abi: iPriceHelperAbi,
      address: priceHelperAddr,
      client: this.publicClient,
    });
  }

  async #configurePartialLiquidator(
    router: Address,
    bot: Address,
  ): Promise<void> {
    const [currentRouter, currentBot, cms] = await Promise.all([
      this.partialLiquidator.read.router(),
      this.partialLiquidator.read.partialLiquidationBot(),
      this.getCreditManagersV3List(),
    ]);

    if (router.toLowerCase() !== currentRouter.toLowerCase()) {
      this.logger.warn(
        `need to update router from ${currentRouter} to ${router}`,
      );
      const { request } = await this.partialLiquidator.simulate.setRouter([
        router,
      ]);
      const hash = await this.executor.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `PartialLiquidator.setRouter(${router}) tx ${hash} reverted`,
        );
      }
      this.logger.info(`set router to ${router} in tx ${hash}`);
    }

    if (bot.toLowerCase() !== currentBot.toLowerCase()) {
      this.logger.warn(`need to update bot from ${currentBot} to ${bot}`);
      const { request } =
        await this.partialLiquidator.simulate.setPartialLiquidationBot([bot]);
      const hash = await this.executor.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });
      if (receipt.status === "reverted") {
        throw new Error(
          `PartialLiquidator.setPartialLiquidationBot(${bot}) tx ${hash} reverted`,
        );
      }
      this.logger.info(`set bot to ${bot} in tx ${hash}`);
    }
    const cmToCa = await this.#getLiquidatorAccounts(cms);
    // TODO: count required number of DefenNFT tokens to transfer from owner to liquidator

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
    const results = await this.publicClient.multicall({
      allowFailure: false,
      contracts: cms.map(cm => ({
        abi: iLiquidatorAbi,
        address: this.partialLiquidator.address,
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
      const { request } = await this.partialLiquidator.simulate.registerCM([
        address,
      ]);
      const hash = await this.executor.walletClient.writeContract(request);
      const receipt = await this.publicClient.waitForTransactionReceipt({
        hash,
      });
      if (receipt.status === "reverted") {
        throw new Error(`Liquidator.registerCM(${address}) reverted`);
      }
      this.logger.info(
        `registered credit manager ${name} (${address}) in tx ${hash}`,
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

  private get partialLiquidator(): ILiquidatorContract {
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
      this.#configuratorAddr = await this.publicClient.readContract({
        address: aclAddr,
        abi: iaclAbi,
        functionName: "owner",
      });
      this.logger.debug(`configurator address: ${this.#configuratorAddr}`);
    }
    return this.#configuratorAddr;
  }
}
