import { Inject, Service } from "typedi";
import { BotService } from "./arbitrageService";
import { Faucet } from "../core/faucet";
import { getManager, Repository } from "typeorm";
import { tokenData } from "../core/tokenData";
import { EthDelayPayload, FaucetResponse } from "../payloads/faucet";

@Service()
export class FaucetService {
  protected repo: Repository<Faucet>;

  @Inject()
  botService: BotService;

  constructor() {
    this.repo = getManager().getRepository<Faucet>(Faucet);
  }

  async getTokenList(address: string): Promise<Array<FaucetResponse>> {
    const faucets = await this.repo.find({ address });

    const nextTimeByTokens: Record<string, number> = {};
    faucets.forEach((f) => (nextTimeByTokens[f.token] = f.nextUpdate));

    return Object.entries(tokenData).map((t) => {
      const nextTime = Math.floor(
        (nextTimeByTokens[t[1].address] || 0) - Date.now() / 1000
      );

      const delay = nextTime > 0 ? nextTime : 0;
      return {
        symbol: t[0],
        address: t[1].address,
        delay,
        rate: this.botService.getRate(t[1].address),
        faucetSize: t[1].faucetSize,
      };
    });
  }

  async getEthDelay(address: string): Promise<EthDelayPayload> {
    const id = `${address}_ETH`;
    let faucet = await this.repo.findOne({ id });
    const nextTime = Math.floor((faucet?.nextUpdate || 0) - Date.now() / 1000);

    const delay = nextTime > 0 ? nextTime : 0;
    return { delay };
  }

  async sendTokens(
    address: string,
    token: string
  ): Promise<Array<FaucetResponse>> {
    console.log("POP", address, token);

    const id = `${address}_${token}`;
    let faucet = await this.repo.findOne({ id });
    if (!faucet) {
      faucet = new Faucet();
      faucet.id = id;
      faucet.address = address;
      faucet.token = token;
      faucet.total = 0;
    }

    const timeStamp = Math.floor(Date.now() / 1000);
    if (faucet.nextUpdate > timeStamp) {
      throw new Error("you should wait");
    }

    faucet.total += await this.botService.pay(address, token);

    faucet.nextUpdate = timeStamp + 24 * 3600;
    await this.repo.save(faucet);

    return this.getTokenList(address);
  }

  async sendETH(address: string): Promise<EthDelayPayload> {
    const id = `${address}_ETH`;
    let faucet = await this.repo.findOne({ id });

    if (!faucet) {
      faucet = new Faucet();
      faucet.id = id;
      faucet.address = address;
      faucet.token = "ETH";
      faucet.total = 0;
    }

    const timeStamp = Math.floor(Date.now() / 1000);
    if (faucet.nextUpdate > timeStamp) {
      throw new Error("you should wait");
    }

    await this.botService.sendEth(address);
    faucet.total += 0.1;

    faucet.nextUpdate = timeStamp + 24 * 3600;
    await this.repo.save(faucet);

    return this.getEthDelay(address);
  }
}
