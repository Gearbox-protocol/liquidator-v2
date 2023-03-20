import {
  RetryProvider,
  RotateProvider,
} from "@gearbox-protocol/devops/lib/providers";
import {
  CreditAccountData,
  CreditManagerWatcher,
  detectNetwork,
  GOERLI_NETWORK,
  IAddressProvider__factory,
  ICreditFacade__factory,
  ICreditManagerV2__factory,
  IERC20__factory,
  MAINNET_NETWORK,
  Multicall2__factory,
  PathFinder,
  PathFinderCloseResult,
  tokenSymbolByAddress,
  TxParser,
} from "@gearbox-protocol/sdk";
import {
  BigNumber,
  ContractReceipt,
  ContractTransaction,
  providers,
  utils,
} from "ethers";
import pRetry from "p-retry";
import { Inject, Service } from "typedi";

import config from "../config";
import { OptimisticResult } from "../core/optimistic";
import { Logger, LoggerInterface } from "../decorators/logger";
import { AMPQService } from "./ampqService";
import { HealthChecker } from "./healthChecker";
import { KeyService } from "./keyService";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "./output";
import { ScanService } from "./scanService";
import { ISwapper, SWAPPER } from "./swap";

interface Balance {
  underlying: BigNumber;
  eth: BigNumber;
}

@Service()
export class LiquidatorService {
  @Logger("LiquidatorService")
  log: LoggerInterface;

  @Inject()
  scanService: ScanService;

  @Inject()
  keyService: KeyService;

  @Inject()
  ampqService: AMPQService;

  @Inject()
  heathChecker: HealthChecker;

  @Inject(OUTPUT_WRITER)
  outputWriter: IOptimisticOutputWriter;

  @Inject(SWAPPER)
  swapper: ISwapper;

  protected provider: providers.Provider;
  protected pathFinder: PathFinder;
  protected slippage: number;

  protected optimistic: Array<OptimisticResult> = [];
  protected etherscan = "";

  /**
   * Launch LiquidatorService
   */
  async launch() {
    this.slippage = Math.floor(config.slippage * 100);
    const rpcs = [
      new RetryProvider(
        {
          url: config.ethProviderRpc,
          timeout: config.ethProviderTimeout,
          allowGzip: true,
        },
        { filterLogRange: 50_000, deployBlock: config.deployBlock },
      ),
    ];
    if (config.fallbackRpc) {
      rpcs.push(
        new RetryProvider(
          {
            url: config.fallbackRpc,
            timeout: config.ethProviderTimeout,
            allowGzip: true,
          },
          { filterLogRange: 50_000, deployBlock: config.deployBlock },
        ),
      );
    }
    this.provider = config.optimisticLiquidations
      ? rpcs[0]
      : new RotateProvider(rpcs, undefined, this.log);

    const startBlock = await this.provider.getBlockNumber();
    const { chainId } = await this.provider.getNetwork();

    switch (chainId) {
      case MAINNET_NETWORK:
        this.etherscan = "https://etherscan.io";
        break;
      case GOERLI_NETWORK:
        this.etherscan = "https://goerli.etherscan.io";
        break;
    }
    const network = await detectNetwork(this.provider);

    await this.ampqService.launch(chainId);

    const addressProvider = IAddressProvider__factory.connect(
      network === "Mainnet"
        ? config.addressProviderMainnet
        : config.addressProviderGoerli,
      this.provider,
    );
    try {
      const [dataCompressor, priceOracle, pathFinder] = await Promise.all([
        addressProvider.getDataCompressor(),
        addressProvider.getPriceOracle(),
        addressProvider.getLeveragedActions(),
      ]);

      this.pathFinder = new PathFinder(pathFinder, this.provider, network, [
        "WETH",
        "DAI",
        "USDC",
      ]);

      if (config.optimisticLiquidations) {
        this.log.warn(
          `Running ${config.underlying} in OPTIMISTIC LIQUIDATION mode`,
        );
      } else {
        this.heathChecker.launch();
        this.log.info("Liquidation bot started");
      }

      await this.keyService.launch();
      await this.swapper.launch(network);
      await this.checkEmergencyPermissions(dataCompressor, startBlock);
      await this.scanService.launch(
        dataCompressor,
        priceOracle,
        this.provider,
        this,
      );
    } catch (e) {
      this.log.error(`Error occurred at launch process: ${e}`);
      process.exit(1);
    }

    if (config.optimisticLiquidations) {
      await this.outputWriter.write(startBlock, this.optimistic);
      process.exit(0);
    }
  }

  async liquidate(ca: CreditAccountData, creditFacade: string) {
    this.ampqService.info(`Start liquidation of ${this.getAccountTitle(ca)}`);

    try {
      const pfResult = await this.findClosePath(ca);
      const pathHuman = TxParser.parseMultiCall(pfResult.calls);
      this.log.debug(pathHuman);

      const executor = this.keyService.takeVacantExecutor();
      const tx = await ICreditFacade__factory.connect(
        creditFacade,
        executor,
      ).liquidateCreditAccount(
        ca.borrower,
        this.keyService.address,
        0,
        true,
        pfResult.calls,
      );

      const receipt = await tx.wait(1);

      this.ampqService.info(
        `Account for borrower ${this.getAccountTitle(
          ca,
        )} was successfully liquidated\nTx receipt: ${this.etherscan}/tx/${
          tx.hash
        }\nGas used: ${receipt.gasUsed
          .toNumber()
          .toLocaleString("en")}\nPath used:\n${pathHuman.join("\n")}`,
      );

      await this.keyService.returnExecutor(executor.address);
    } catch (e) {
      this.ampqService.error(
        `Cant liquidate ${this.getAccountTitle(ca)}: ${e}`,
      );
    }
  }

  async liquidateOptimistic(
    ca: CreditAccountData,
    creditFacade: string,
  ): Promise<void> {
    let snapshotId: unknown;
    const optimisticResult: OptimisticResult = {
      creditManager: ca.creditManager,
      borrower: ca.borrower,
      gasUsed: 0,
      calls: [],
      isError: false,
      pathAmount: "0",
      liquidatorPremium: "0",
      liquidatorProfit: "0",
    };
    const start = Date.now();

    try {
      this.log.debug(`Searching path for ${ca.hash()}...`);
      const pfResult = await this.findClosePath(ca);
      optimisticResult.calls = pfResult.calls;
      optimisticResult.pathAmount = pfResult.underlyingBalance.toString();

      const pathHuman = TxParser.parseMultiCall(pfResult.calls);
      this.log.debug({ pathHuman }, "path found");

      const balanceBefore = await this.getExecutorBalance(ca);
      const iFacade = ICreditFacade__factory.connect(
        creditFacade,
        this.keyService.signer,
      );
      // before actual transaction, try to estimate gas
      // this effectively will load state and contracts from fork origin to anvil
      // so following actual tx should not be slow
      // also tx will act as retry in case of anvil external's error
      try {
        const estGas = await iFacade.estimateGas.liquidateCreditAccount(
          ca.borrower,
          this.keyService.address,
          0,
          true,
          pfResult.calls,
        );
        this.log.debug(`estimated gas: ${estGas}`);
      } catch (e: any) {
        if (e.code === utils.Logger.errors.UNPREDICTABLE_GAS_LIMIT) {
          this.log.error(`failed to estimate gas: ${e.reason}`);
        } else {
          this.log.debug(`failed to esitmate gas: ${e.code} ${Object.keys(e)}`);
        }
      }

      // save snapshot after all read requests are done
      snapshotId = await (this.provider as providers.JsonRpcProvider).send(
        "evm_snapshot",
        [],
      );
      // Actual liquidation (write requests start here)
      try {
        // this is needed because otherwise it's possible to hit deadlines in uniswap calls
        await (this.provider as providers.JsonRpcProvider).send(
          "anvil_setBlockTimestampInterval",
          [12],
        );
        const tx = await iFacade.liquidateCreditAccount(
          ca.borrower,
          this.keyService.address,
          0,
          true,
          pfResult.calls,
          { gasLimit: 29e6 }, // should be ok because we top up in optimistic
        );
        this.log.debug(`Liquidation tx receipt: ${tx.hash}`);
        const receipt = await this.mine(tx);

        let balanceAfter = await this.getExecutorBalance(ca);
        optimisticResult.gasUsed = receipt.gasUsed.toNumber();
        optimisticResult.liquidatorPremium = balanceAfter.underlying
          .sub(balanceBefore.underlying)
          .toString();

        // swap underlying back to ETH
        await this.swapper.swap(
          this.keyService.signer,
          ca.underlyingToken,
          balanceAfter.underlying,
        );
        balanceAfter = await this.getExecutorBalance(ca);
        optimisticResult.liquidatorProfit = balanceAfter.eth
          .sub(balanceBefore.eth)
          .toString();
      } catch (e: any) {
        optimisticResult.isError = true;
        this.log.error(`Cant liquidate ${this.getAccountTitle(ca)}: ${e}`);
        optimisticResult.txTrace = await this.getTrace(e.transactionHash);
      }
    } catch (e: any) {
      optimisticResult.isError = true;
      this.log.error(
        { account: this.getAccountTitle(ca) },
        `cannot liquidate: ${e}`,
      );
    }

    optimisticResult.duration = Date.now() - start;
    this.optimistic.push(optimisticResult);

    if (snapshotId) {
      await (this.provider as providers.JsonRpcProvider).send("evm_revert", [
        snapshotId,
      ]);
    }
  }

  protected getAccountTitle(ca: CreditAccountData): string {
    const cmSymbol = tokenSymbolByAddress[ca.underlyingToken];

    return `${ca.borrower} in ${cmSymbol}[${this.etherscan}/address/${ca.creditManager}]`;
  }

  protected async findClosePath(
    ca: CreditAccountData,
  ): Promise<PathFinderCloseResult> {
    try {
      const result = await this.pathFinder.findBestClosePath(
        ca,
        this.slippage,
        true,
      );
      if (!result) {
        throw new Error("result is empty");
      }
      return result;
    } catch (e) {
      throw new Error(`cant find close path: ${e}`);
    }
  }

  /**
   * Performs one-time check that all executors have permissions to liquidate while paused on all enabled credit managers
   * @param dataCompressor
   * @param blockNumber
   */
  private async checkEmergencyPermissions(
    dataCompressor: string,
    blockNumber: number,
  ): Promise<void> {
    this.log.debug("Checking emergency permissions");
    const creditManagers = await CreditManagerWatcher.getV2CreditManagers(
      dataCompressor,
      this.provider,
    );

    const mc = Multicall2__factory.connect(
      config.multicallAddress,
      this.provider,
    );
    const cmi = ICreditManagerV2__factory.createInterface();

    const liquidators = [
      this.keyService.signer.address,
      ...this.keyService.getExecutorAddress(),
    ];

    // make one multicall, where for each enabled cm and each liquidator address we check emergency permissions
    const calls = Object.values(creditManagers)
      .filter(cm => {
        // If single CreditManager mode is on, use only this manager
        const symb = tokenSymbolByAddress[cm.underlyingToken];
        return (
          !config.underlying ||
          config.underlying.toLowerCase() === symb.toLowerCase()
        );
      })
      .flatMap(cm =>
        liquidators.map(liqAddr => ({
          target: cm.address,
          callData: cmi.encodeFunctionData("canLiquidateWhilePaused", [
            liqAddr,
          ]),
        })),
      );

    this.log.debug(
      `Will perform ${calls.length} canLiquidateWhilePaused calls`,
    );
    const { returnData } = await mc.callStatic.aggregate(calls, {
      blockTag: blockNumber,
    });

    returnData.forEach((d, i) => {
      const [enabled] = cmi.decodeFunctionResult("canLiquidateWhilePaused", d);
      const [liquidator] = cmi.decodeFunctionData(
        "canLiquidateWhilePaused",
        calls[i].callData,
      );
      if (enabled) {
        this.log.debug(
          { liquidator, creditManager: calls[i].target },
          "can work in emergency mode",
        );
      } else {
        this.log.warn(
          { liquidator, creditManager: calls[i].target },
          "cannot work in emergency mode",
        );
      }
    });
  }

  private async getExecutorBalance(ca: CreditAccountData): Promise<Balance> {
    const underlyingP =
      tokenSymbolByAddress[ca.underlyingToken] === "WETH"
        ? this.provider.getBalance(this.keyService.address)
        : IERC20__factory.connect(
            ca.underlyingToken,
            this.keyService.signer,
          ).balanceOf(this.keyService.address);
    const [eth, underlying] = await Promise.all([
      this.provider.getBalance(this.keyService.address),
      underlyingP,
    ]);
    return { eth, underlying };
  }

  /**
   * Mines transaction on anvil. Because sometimes it gets stuck for unknown reasons,
   * add retries and timeout
   * @param tx
   * @returns
   */
  private async mine(tx: ContractTransaction): Promise<ContractReceipt> {
    const run = async () => {
      await (this.provider as providers.JsonRpcProvider).send("evm_mine", []);
      const receipt: ContractReceipt = await Promise.race([
        tx.wait(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Timeout"));
          }, 30 * 1000);
        }),
      ]);
      return receipt;
    };
    return pRetry(run, { retries: 3 });
  }

  private async getTrace(txHash: string): Promise<unknown> {
    try {
      const txTrace = await (this.provider as providers.JsonRpcProvider).send(
        "trace_transaction",
        [txHash],
      );
      return txTrace;
    } catch (e) {
      return undefined;
    }
  }
}
