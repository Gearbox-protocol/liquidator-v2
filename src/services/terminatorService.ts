import { Inject, Service } from "typedi";
import config, { SUSHISWAP_ADDRESS, UNISWAP_V2_ADDRESS } from "../config";
import { providers, Wallet } from "ethers";
import {
  IAddressProvider__factory,
  IDataCompressor,
  IDataCompressor__factory,
  Terminator,
  Terminator__factory,
} from "../types/ethers-v5";
import { Logger, LoggerInterface } from "../decorators/logger";
import { CreditManagerDataPayload, formatBN } from "@diesellabs/gearbox-sdk";
import { CreditManager } from "../core/creditManager";
import { OracleService } from "./oracleService";
import { TokenService } from "./tokenService";
import { ExecutorService } from "./executorService";
import { ExecutorJob } from "../core/executor";
import { UniswapService } from "./uniswapService";
import { CreditAccount } from "../core/creditAccount";
import { AMPQService } from "./ampqService";

@Service()
export class TerminatorService {
  @Logger("TerminatorService")
  log: LoggerInterface;

  @Inject()
  oracleService: OracleService;

  @Inject()
  tokenService: TokenService;

  @Inject()
  executorService: ExecutorService;

  @Inject()
  uniswapService: UniswapService;

  @Inject()
  ampqService: AMPQService;

  protected wallet: Wallet;
  protected routers: Array<string>;
  protected botContract: Terminator;
  protected dataCompressor: IDataCompressor;
  protected creditManagers: Array<CreditManager>;
  protected provider: providers.JsonRpcProvider;

  protected nextSync: number;
  protected isUpdating: boolean;

  constructor() {
    this.routers = [UNISWAP_V2_ADDRESS, SUSHISWAP_ADDRESS];
    this.nextSync = 0;
  }

  async launch() {
    this.provider = new providers.JsonRpcProvider(config.ethProviderRpc);
    this.wallet = new Wallet(config.privateKey, this.provider);

    await this.ampqService.launch();

    this.botContract = await Terminator__factory.connect(
      config.botAddress,
      this.wallet
    );

    const addressProvider = IAddressProvider__factory.connect(
      config.addressProvider,
      this.wallet
    );

    const [dataCompressorAddress, priceOracleAddress, wethToken] =
      await Promise.all([
        addressProvider.getDataCompressor(),
        addressProvider.getPriceOracle(),
        addressProvider.getWethToken(),
      ]);

    this.dataCompressor = IDataCompressor__factory.connect(
      dataCompressorAddress,
      this.wallet
    );

    await this.tokenService.launch(config.botAddress, this.wallet, wethToken);
    await this.oracleService.launch(priceOracleAddress, this.wallet, wethToken);
    await this.uniswapService.connect(
      UNISWAP_V2_ADDRESS,
      wethToken,
      this.wallet
    );
    await this.executorService.launch(this.wallet, this.provider);

    const executors = this.executorService.getExecutorAddress();
    for (const ex of executors) {
      const isExecutorInList = await this.botContract.executors(ex);
      if (!isExecutorInList) {
        const receipt = await this.botContract.allowExecutor(ex, {
          gasLimit: 100000,
        });
        await receipt.wait();
      }
    }

    await this.loadCreditManagers();
    const blockNum = this.provider.blockNumber;
    await this._onNewBlock(blockNum);

    this.provider.on("block", async (num) => await this._onNewBlock(num));
  }

  protected async _onNewBlock(num: number) {
    if (this.isUpdating || num < this.nextSync) return;
    this.isUpdating = true;

    this.log.info(`Starting block update ${num}`);
    try {
      const block = await this.provider.getBlock("latest");
      const timestamp = block.timestamp;

      await this.oracleService.updatePrices();

      const accountsToLiquidate = this.creditManagers
        .map((cm) => cm.update(timestamp))
        .reduce((a, b) => [...a, ...b]);

      console.log("Accounts to liquidatate: ", accountsToLiquidate);

      const jobs: Array<ExecutorJob> = accountsToLiquidate.map((account) =>
        this.getLiquidationJob(account)
      );

      await this.executorService.addToQueue(jobs);

      this.log.info(`Update block #${num} competed`);
      this.nextSync = num + config.skipBlocks;
    } catch (e) {
      this.log.error(`Errors during update block #${num}`, e);
    } finally {
      this.isUpdating = false;
    }
  }

  async liquidateOne(account: CreditAccount) {
    this.log.info(`Liquidating ${account.borrower} address`);
    const job = this.getLiquidationJob(account);
    await this.executorService.addToQueue([job]);
  }

  getLiquidationJob(account: CreditAccount): ExecutorJob {
    return async (executor) => {
      const botContract = Terminator__factory.connect(
        this.botContract.address,
        executor
      );
      const paths = await this.uniswapService.findBestRoutes(
        account.underlyingToken,
        account.allowedTokens,
        account.balances
      );

      const balance = this.tokenService.getBalance(account.underlyingToken);
      const liquidationAmount = account.liquidationAmount;
      const decimals = this.tokenService.decimals(account.underlyingToken);
      if (balance.lt(liquidationAmount)) {
        const msg = `Not enough balance: ${formatBN(
          liquidationAmount,
          decimals
        )} ${this.tokenService.symbol(
          account.underlyingToken
        )} but has only ${formatBN(balance, decimals)}. Please send money to ${
          this.botContract.address
        }`;

        this.log.error(msg);
        this.ampqService.sendMessage(msg);
        return;
      }

      const receipt = await botContract.liquidateAndSellOnV2(
        account.creditManager,
        account.borrower,
        UNISWAP_V2_ADDRESS,
        paths,
        { gasLimit: 3000000 }
      );

      await receipt.wait();

      const msg = `Account ${account.borrower} in ${this.tokenService.symbol(
        account.underlyingToken
      )} credit manager was liquidated`;
      this.log.info(msg);
      this.ampqService.sendMessage(msg);
      return receipt;
    };
  }

  async loadCreditManagers() {
    try {
      this.log.info("Getting credit managers...");

      const creditManagersPayload =
        (await this.dataCompressor.getCreditManagersList(
          this.wallet.address
        )) as unknown as Array<CreditManagerDataPayload>;

      this.creditManagers = creditManagersPayload.map(
        (c) => new CreditManager(c, this.dataCompressor, this.wallet, this.log)
      );

      await Promise.all(
        this.creditManagers.map(async (cm) => await cm.launch())
      );
    } catch (e) {
      this.log.error("Cant load credit manager");
      this.log.error(e);
    }
  }
}
