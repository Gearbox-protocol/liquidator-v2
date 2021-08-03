import { Inject, Service } from "typedi";
import config from "../config";
import { BotService } from "./arbitrageService";
import { providers, Wallet } from "ethers";

@Service()
export class SyncService {
  @Inject()
  protected botService: BotService;

  provider: providers.JsonRpcProvider;
  wallet: Wallet;

  private isUpdating: boolean;

  async launch() {
    this.provider = new providers.JsonRpcProvider(config.ethProviderRpc);
    this.wallet = new Wallet(config.privateKey, this.provider);

    await this.botService.launch(this.wallet);

    this.provider.on("block", (num) => this._update(num));
  }

  protected async _update(num: number) {
    if (this.isUpdating) return;
    this.isUpdating = true;

    console.log(`Starting block update ${num}`);
    try {
      await this.botService.updateTokens();
      console.log(`Update block #${num} competed`);
    } catch (e) {
      console.log(`Errors during update block #${num}`, e);
    } finally {
      this.isUpdating = false;
    }
  }
}
