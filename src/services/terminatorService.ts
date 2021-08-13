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
import { Job } from "../core/job";
import { Logger, LoggerInterface } from "../decorators/logger";
import { CreditManagerDataPayload } from "@diesellabs/gearbox-sdk";
import { CreditManager } from "../core/creditManager";
import { OracleService } from "./oracleService";
import { TokenService } from "./tokenService";
import { ExecutorService } from "./executorService";

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

  protected _jobs: Array<Job> = [];

  protected wallet: Wallet;
  protected routers: Array<string>;
  protected botContract: Terminator;
  protected dataCompressor: IDataCompressor;
  protected creditManagers: Array<CreditManager>;
  protected provider: providers.JsonRpcProvider;

  private isUpdating: boolean;

  constructor() {
    this.routers = [UNISWAP_V2_ADDRESS, SUSHISWAP_ADDRESS];
  }

  async launch() {
    this.provider = new providers.JsonRpcProvider(config.ethProviderRpc);
    this.wallet = new Wallet(config.privateKey, this.provider);

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

    await this.loadCreditManagers();

    this.provider.on("block", async (num) => await this._onNewBlock(num));
  }

  protected async _onNewBlock(num: number) {
    if (this.isUpdating) return;
    this.isUpdating = true;

    console.log(`Starting block update ${num}`);
    try {
      const block = await this.provider.getBlock("latest");
      const timestamp = block.timestamp;

      await this.oracleService.updatePrices();

      const accountsToLiquidate = this.creditManagers
        .map((cm) => cm.update(timestamp))
        .reduce((a, b) => [...a, ...b]);

      console.log("LIQUIDATE!!!", accountsToLiquidate);

      console.log(`Update block #${num} competed`);
    } catch (e) {
      console.log(`Errors during update block #${num}`, e);
    } finally {
      this.isUpdating = false;
    }
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
