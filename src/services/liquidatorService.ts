import {
  CreditAccountData,
  detectNetwork,
  GOERLI_NETWORK,
  IAddressProvider__factory,
  ICreditFacade__factory,
  IERC20__factory,
  MAINNET_NETWORK,
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
  protected etherscan = "";

  /**
   * Launch LiquidatorService
   */
  async launch() {
    this.slippage = Math.floor(config.slippage * 100);
    this.provider = new providers.StaticJsonRpcProvider({
      url: config.ethProviderRpc,
      timeout: config.ethProviderTimeout,
    });

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
      await this.scanService.launch(
        dataCompressor,
        priceOracle,
        startBlock,
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
    };
    const start = Date.now();

    try {
      this.log.debug(`Searching path for ${ca.hash()}...`);
      const pfResult = await this.findClosePath(ca);
      optimisticResult.calls = pfResult.calls;
      optimisticResult.pathAmount = pfResult.underlyingBalance.toString();

      const pathHuman = TxParser.parseMultiCall(pfResult.calls);
      this.log.debug({ pathHuman }, "path found");

      const getExecutorBalance = async (): Promise<BigNumber> => {
        return tokenSymbolByAddress[ca.underlyingToken] === "WETH"
          ? await this.provider.getBalance(this.keyService.address)
          : await IERC20__factory.connect(
              ca.underlyingToken,
              this.keyService.signer,
            ).balanceOf(this.keyService.address);
      };
      const balanceBefore = await getExecutorBalance();
      // save snapshot after all read requests are done
      snapshotId = await (this.provider as providers.JsonRpcProvider).send(
        "evm_snapshot",
        [],
      );
      // Actual liquidation (write requests start here)
      try {
        // this is needed because otherwise it's possible to heat deadlines in uniswap calls
        await (this.provider as providers.JsonRpcProvider).send(
          "anvil_setBlockTimestampInterval",
          [12],
        );
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
        if (receipt.gasUsed.gt(29e6)) {
          optimisticResult.isError = true;
          this.log.error(`Too much gas used: ${receipt.gasUsed}`);
        } else {
          this.log.debug(`Gas used: ${receipt.gasUsed}`);
        }
      } catch (e) {
        optimisticResult.isError = true;
        this.log.error(`Cant liquidate ${this.getAccountTitle(ca)}: ${e}`);
        const ptx = await ICreditFacade__factory.connect(
          creditFacade,
          this.keyService.signer,
        ).populateTransaction.liquidateCreditAccount(
          ca.borrower,
          this.keyService.address,
          0,
          true,
          pfResult.calls,
        );
        this.log.debug({ transaction: ptx });
      }
    } catch (e) {
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
}
