import {
  CHAINS,
  formatBN,
  getDecimals,
  IERC20__factory,
  NetworkType,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import axios, { AxiosInstance } from "axios";
import { BigNumberish, ethers, Wallet } from "ethers";
import { Service } from "typedi";

import { Logger, LoggerInterface } from "../../decorators/logger";
import { mine } from "../utils";
import BaseSwapper from "./base";
import { ISwapper } from "./types";

const ROUTER_v5 = "0x1111111254EEB25477B68fb85Ed929f73A960582";
const ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

@Service()
export default class OneInch extends BaseSwapper implements ISwapper {
  @Logger("one_inch")
  log: LoggerInterface;

  private apiClient: AxiosInstance;

  public async launch(network: NetworkType): Promise<void> {
    await super.launch(network);
    this.apiClient = axios.create({
      baseURL: `https://api.1inch.io/v5.0/${CHAINS[network]}`,
    });
  }

  public async swap(
    executor: Wallet,
    tokenAddr: string,
    amount: BigNumberish,
  ): Promise<void> {
    const amnt = formatBN(amount, getDecimals(tokenAddr));
    try {
      if (tokenAddr.toLowerCase() === this.wethAddr.toLowerCase()) {
        // WETH is unwrapped during liquidation (convertWETH flag)
        return;
      }
      this.log.debug(
        `Swapping ${amnt} ${tokenSymbolByAddress[tokenAddr]} back to ETH`,
      );
      const erc20 = IERC20__factory.connect(tokenAddr, executor);
      const approveTx = await erc20.approve(ROUTER_v5, amount);
      await mine(
        executor.provider as ethers.providers.JsonRpcProvider,
        approveTx,
      );

      const swap = await this.apiClient.get("/swap", {
        params: {
          fromTokenAddress: tokenAddr,
          toTokenAddress: ETH,
          amount: amount.toString(),
          fromAddress: executor.address,
          slippage: 1,
          disableEstimate: true,
          allowPartialFill: false,
        },
      });

      const {
        tx: { gas, gasPrice, ...tx },
        // ...rest
      } = swap.data;

      const txR = await executor.sendTransaction({ ...tx, gasLimit: 29e6 });
      await mine(executor.provider as ethers.providers.JsonRpcProvider, txR);
      this.log.debug(
        `Swapped ${amnt} ${tokenSymbolByAddress[tokenAddr]} back to ETH`,
      );
    } catch (e) {
      this.log.error(
        `Failed to swap ${amnt} ${tokenSymbolByAddress[tokenAddr]} back to ETH: ${e}`,
      );
    }
  }
}
