import { Service } from "typedi";
import config, {
  SUSHISWAP_ADDRESS,
  UNISWAP_V2_ADDRESS,
  WETH_TOKEN,
} from "../config";
import { tokenData, TokenData } from "../core/tokenData";
import { Wallet } from "ethers";
import {
  AggregatorV3Interface__factory,
  ArbBot,
  ArbBot__factory,
  ERC20__factory,
} from "../types/ethers-v5";
import { formatBN } from "../utils/formatter";
import { Pair } from "../core/pair";
import { Token } from "../core/token";
import { TokenPayload } from "../payloads/pairs";
import { Job } from "../core/job";

@Service()
export class BotService {
  public readonly tokensToCheck: Record<string, TokenData>;
  protected _tokens: Record<string, Token> = {};
  protected _pairs: Record<string, Record<string, Pair>> = {};
  protected _jobs: Array<Job> = [];

  wallet: Wallet;
  routers: Array<string>;
  botContract: ArbBot;

  constructor() {
    this.tokensToCheck = tokenData;
    this.routers = [UNISWAP_V2_ADDRESS, SUSHISWAP_ADDRESS];
  }

  async launch(wallet: Wallet) {
    this.wallet = wallet;

    this.botContract = await ArbBot__factory.connect(
      config.botAddress,
      this.wallet
    );

    Token.botAddress = config.botAddress;

    await this.initTokens(WETH_TOKEN, undefined);
    const promises = Object.values(this.tokensToCheck).map((token) =>
      this.initTokens(token.address, token.priceFeed)
    );
    await Promise.all(promises);

    for (const router of this.routers) {
      for (const token of Object.values(this.tokensToCheck)) {
        this._jobs.push({ router, address: token.address });
      }
    }

    // for (const token of Object.values(this.tokensToCheck)) {
    //   const balance = await this._balances[token.address];
    //
    //   if (balance.isZero()) {
    //     const contract = await this._tokenContracts[token.address];
    //     const decimals = await contract.decimals();
    //     const receipt = await contract.transfer(
    //       this.botContract.address,
    //       BigNumber.from(10).pow(decimals).mul(10000),
    //       { gasLimit: 100000 }
    //     );
    //     await receipt.wait();
    //     this._balances[token.address] = await contract.balanceOf(
    //       this.botContract.address
    //     );
    //   }
    // }
  }

  async initTokens(address: string, priceFeed: string | undefined) {
    const contract = ERC20__factory.connect(address, this.wallet);
    this._tokens[address] = await Token.newToken(address, contract);

    const priceFeedContract = priceFeed
      ? AggregatorV3Interface__factory.connect(priceFeed, this.wallet)
      : undefined;

    for (const router of this.routers) {
      if (!this._pairs[router]) this._pairs[router] = {};
      this._pairs[router][address] = new Pair(address, this._tokens[address].decimals, priceFeedContract);
      await this._pairs[router][address].updateChainlinkLastUpdate();
    }
  }

  async updateTokens() {
    const jobPromises = this._jobs.map(job => this.updatePairs(job));
    await Promise.all(jobPromises);

    for (const router of this.routers) {
      console.log(`Updating router: ${router}`);
      for (const token of Object.entries(this.tokensToCheck)) {
        const symbol = token[0];
        const tokenAddress = token[1].address;

        const pair = this._pairs[router][tokenAddress];
        if (!pair) {
          throw new Error(`cant find pair for ${tokenAddress}`);
        }

        const diff = pair.ratio;
        //2745269715150372444180
        console.log(symbol);
        pair.print();

        if (Math.abs(diff - 100) > 2) {
          const [dr, tokenAddr] = pair.computeDr();
          const tokenNeeded = this._tokens[tokenAddr];
          const symbolNeeded = tokenNeeded.symbol;

          console.log(
            `Updating pair ${symbol}-ETH with diff ${diff} ${formatBN(
              dr,
              18
            )} ${symbolNeeded} needed`
          );

          if (tokenNeeded.balance.lt(dr)) {
            console.log(
              `Not enought balance at ${symbolNeeded}).  Have: ${formatBN(
                tokenNeeded.balance,
                18
              )} Needed: ${formatBN(dr, 18)}`
            );
            continue;
          }

          try {
            const receipt = await this.botContract.updatePrice(
              router,
              tokenAddress,
              WETH_TOKEN,
              { gasLimit: 500000 }
            );
            await receipt.wait();
            const diff = await this.getDiff(router, tokenAddress);
            console.log(`Updated successfully, current diff is ${diff}`);

            await pair.updateLastUpdate();

            await tokenNeeded.updateBalance();
            await this._tokens[WETH_TOKEN].updateBalance();
          } catch (e) {
            console.log("Cant update token pair", e);
          }
        }
      }
    }
  }

  protected async updatePairs(job: Job) {
    const [reserve0, reserve1, reserve1CL] = await this.botContract.checkUniV2(
      job.router,
      job.address,
      WETH_TOKEN
    );

    const pair = this._pairs[job.router][job.address];
    if (!pair) {
      throw new Error(`cant find pair for ${job.address}`);
    }
    pair.updateRate(reserve0, reserve1, reserve1CL);
  }

  protected async getDiff(router: string, token: string): Promise<number> {
    const [, reserve1, reserve1CL] = await this.botContract.checkUniV2(
      router,
      token,
      WETH_TOKEN
    );
    return reserve1.mul(100).div(reserve1CL).toNumber();
  }

  pairList(): Array<TokenPayload> {
    const result: Array<TokenPayload> = [];
    for (const token of Object.values(this._tokens)) {
      const tokenPayload: TokenPayload = {
        address: token.address,
        symbol: token.symbol,
        pairs: {},
        chainLinkUpdate: 0,
        tokenBalance: token.balance.toString(),
      };

      this.routers.forEach((r) => {
        tokenPayload.pairs[r] = this._pairs[r][token.address].getPayload();
      });

      result.push(tokenPayload);
    }

    return result;
  }
}
