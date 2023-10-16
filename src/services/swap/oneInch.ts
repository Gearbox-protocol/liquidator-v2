import type { NetworkType } from "@gearbox-protocol/sdk";
import {
  CHAINS,
  formatBN,
  getDecimals,
  IERC20__factory,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import type { AxiosInstance } from "axios";
import axios from "axios";
import type { BigNumberish, ethers, Wallet } from "ethers";
import { Service } from "typedi";

import config from "../../config";
import { Logger, LoggerInterface } from "../../log";
import { mine } from "../utils";
import BaseSwapper from "./base";
import type { ISwapper } from "./types";

const ROUTER_v5 = "0x1111111254EEB25477B68fb85Ed929f73A960582";
const ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

@Service()
export default class OneInch extends BaseSwapper implements ISwapper {
  @Logger("one_inch")
  log: LoggerInterface;

  private apiClient: AxiosInstance;

  public async launch(network: NetworkType): Promise<void> {
    await super.launch(network);
    if (!config.oneInchApiKey) {
      throw new Error("1inch API key not provided");
    }
    const baseURL = `https://api.1inch.dev/swap/v5.2/${CHAINS[network]}`;
    this.apiClient = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${config.oneInchApiKey}`,
        accept: "application/json",
      },
    });
    this.log.debug(`API URL: ${baseURL}`);
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
          src: tokenAddr,
          dst: ETH,
          amount: amount.toString(),
          from: executor.address,
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
