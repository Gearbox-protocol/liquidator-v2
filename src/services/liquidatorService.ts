import {
  CreditAccountData,
  detectNetwork,
  getEtherscan,
  IAddressProvider__factory,
  ICreditFacade__factory,
  IERC20__factory,
  PathFinder,
  PathFinderCloseResult,
  tokenSymbolByAddress,
  TxParser,
} from "@gearbox-protocol/sdk";
import { BigNumber, providers } from "ethers";
import { Inject, Service } from "typedi";

import config from "../config";
import { OptimisticResult } from "../core/optimistic";
import { Logger, LoggerInterface } from "../decorators/logger";
import { AMPQService } from "./ampqService";
import { HealthChecker } from "./healthChecker";
import { KeyService } from "./keyService";
import { IOptimisticOutputWriter, OUTPUT_WRITER } from "./output";
import { ScanService } from "./scanService";

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

  protected provider: providers.Provider;
  protected pathFinder: PathFinder;
  protected slippage: number;

  protected optimistic: Array<OptimisticResult> = [];
  protected etherscan: string;

  /**
   * Launch LiquidatorService
   */
  async launch() {
    this.slippage = Math.floor(config.slippage * 100);
    this.provider = new providers.JsonRpcProvider({
      url: config.ethProviderRpc,
      timeout: config.ethProviderTimeout,
    });

    const startBlock = await this.provider.getBlockNumber();

    this.etherscan = getEtherscan(5);

    await this.ampqService.launch(5);

    const addressProvider = IAddressProvider__factory.connect(
      config.addressProvider,
      this.provider,
    );
    try {
      const [dataCompressor, priceOracle, pathFinder] = await Promise.all([
        addressProvider.getDataCompressor(),
        addressProvider.getPriceOracle(),
        addressProvider.getLeveragedActions(),
      ]);

      const network = await detectNetwork(this.provider);
      this.pathFinder = new PathFinder(pathFinder, this.provider, network, [
        "WETH",
        "DAI",
        "USDC",
      ]);

      if (config.optimisticLiquidations) {
        this.log.warn("Running in OPTIMISTIC LIQUIDATION mode");
      } else {
        this.heathChecker.launch();
        this.ampqService.info("Liquidation bot started");
      }

      await this.keyService.launch(this.provider);
      await this.scanService.launch(
        dataCompressor,
        priceOracle,
        this.provider,
        this,
      );
    } catch (e) {
      this.ampqService.error(`Error occurred at launch process\n${e}`);
    }

    if (config.optimisticLiquidations) {
      await this.outputWriter.write(startBlock, this.optimistic);
      process.exit(0);
    }
  }

  async liquidate(ca: CreditAccountData, creditFacade: string) {
    this.ampqService.info(
      `Start liquidation for borrower ${this.getAccountTitle(ca)}`,
    );

    const pfResult = await this.findClosePath(ca);

    if (!pfResult) {
      return;
    }

    const pathHuman = TxParser.parseMultiCall(pfResult.calls);
    this.log.debug(pathHuman);

    try {
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
        `Cant liquidate ${this.getAccountTitle(
          ca,
        )}\nPath using:${pathHuman}\n${e}`,
      );
    }
  }

  async liquidateOptimistic(ca: CreditAccountData, creditFacade: string) {
    const snapshotId = await (this.provider as providers.JsonRpcProvider).send(
      "evm_snapshot",
      [],
    );

    const optimisticResult: OptimisticResult = {
      creditManager: ca.creditManager,
      borrower: ca.borrower,
      gasUsed: 0,
      calls: [],
      isError: false,
      pathAmount: "0",
      liquidatorPremium: "0",
    };
    const start = Date.now();

    try {
      this.log.debug(`Searching path for ${ca.hash()}...`);
      const pfResult = await this.findClosePath(ca);

      if (!pfResult) {
        throw new Error("Cant find path");
      }

      optimisticResult.calls = pfResult.calls;
      optimisticResult.pathAmount = pfResult.underlyingBalance.toString();

      const pathHuman = TxParser.parseMultiCall(pfResult.calls);
      this.log.debug(pathHuman);

      const getExecutorBalance = async (): Promise<BigNumber> => {
        return tokenSymbolByAddress[ca.underlyingToken] === "WETH"
          ? await this.provider.getBalance(this.keyService.address)
          : await IERC20__factory.connect(
              ca.underlyingToken,
              this.keyService.signer,
            ).balanceOf(this.keyService.address);
      };
      const balanceBefore = await getExecutorBalance();

      // const ptx = await ICreditFacade__factory.connect(
      //   creditFacade,
      //   this.keyService.signer,
      // ).populateTransaction.liquidateCreditAccount(
      //   ca.borrower,
      //   this.keyService.address,
      //   0,
      //   true,
      //   pfResult.calls,
      // );

      // console.log(ptx);

      const tx = await ICreditFacade__factory.connect(
        creditFacade,
        this.keyService.signer,
      ).liquidateCreditAccount(
        ca.borrower,
        this.keyService.address,
        0,
        true,
        pfResult.calls,
      );
      this.log.debug(`Liquidation tx receipt: ${tx.hash}`);

      await (this.provider as providers.JsonRpcProvider).send("evm_mine", []);

      const receipt = await tx.wait();

      const balanceAfter = await getExecutorBalance();

      optimisticResult.liquidatorPremium = balanceAfter
        .sub(balanceBefore)
        .toString();

      optimisticResult.gasUsed = receipt.gasUsed.toNumber();
      this.log.debug(`Gas used: ${receipt.gasUsed}`);
    } catch (e) {
      optimisticResult.isError = true;
      this.ampqService.error(
        `Cant liquidate ${this.getAccountTitle(
          ca,
        )}\nPath using:${TxParser.parseMultiCall(
          optimisticResult.calls,
        )}\n${e}`,
      );
    }

    optimisticResult.duration = Date.now() - start;
    this.optimistic.push(optimisticResult);

    await (this.provider as providers.JsonRpcProvider).send("evm_revert", [
      snapshotId,
    ]);
  }

  protected getAccountTitle(ca: CreditAccountData): string {
    const cmSymbol = tokenSymbolByAddress[ca.underlyingToken];

    return `${ca.borrower} in ${cmSymbol}[${this.etherscan}/address/${ca.creditManager}]`;
  }

  protected async findClosePath(
    ca: CreditAccountData,
  ): Promise<PathFinderCloseResult | undefined> {
    try {
      return await this.pathFinder.findBestClosePath(ca, this.slippage);
    } catch (e) {
      this.ampqService.error(
        `Cant find path for closing account:\n${this.getAccountTitle(
          ca,
        )}\nslippage:${this.slippage}\n${ca.addr}\n${e}`,
      );
    }
  }
}
