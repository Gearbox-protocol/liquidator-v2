import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import {
  CHAINS,
  formatBN,
  getDecimals,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import { IERC20__factory } from "@gearbox-protocol/types/v3";
import type { AxiosInstance } from "axios";
import axios from "axios";
import axiosRetry from "axios-retry";
import type { Wallet } from "ethers";
import { Inject, Service } from "typedi";

import { CONFIG, type ConfigSchema } from "../../config";
import { Logger, type LoggerInterface } from "../../log";
import ExecutorService from "../ExecutorService";
import BaseSwapper from "./base";
import type { ISwapper } from "./types";

const ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

class OneInchError extends Error {
  transactionHash?: string;
}

@Service()
export default class OneInch extends BaseSwapper implements ISwapper {
  @Logger("one_inch")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: ConfigSchema;

  @Inject()
  executor: ExecutorService;

  private apiClient: AxiosInstance;
  private readonly slippage: number;
  private routerAddress = "0x111111125421cA6dc452d289314280a0f8842A65";

  constructor(slippage = 2) {
    super();
    this.slippage = slippage;
  }

  public async launch(network: NetworkType): Promise<void> {
    await super.launch(network);
    if (!this.config.oneInchApiKey) {
      throw new Error("1inch API key not provided");
    }
    const baseURL = `https://api.1inch.dev/swap/v6.0/${CHAINS[network]}`;
    this.apiClient = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${this.config.oneInchApiKey}`,
        accept: "application/json",
      },
    });
    axiosRetry(this.apiClient, {
      retries: 5,
      retryCondition: e => e.response?.status === 429,
      retryDelay: axiosRetry.exponentialDelay,
      onRetry: (_, e) => {
        this.log.debug({ statusCode: e.status, data: e.response?.data });
      },
    });
    this.log.debug(`API URL: ${baseURL}`);
    try {
      const resp = await this.apiClient.get("/approve/spender");
      this.routerAddress = resp.data.address;
      this.log.info(`1inch router address: ${this.routerAddress}`);
    } catch (e) {
      this.log.error(`failed to get router address: ${e}`);
    }
  }

  public async swap(
    executor: Wallet,
    tokenAddr: string,
    amount: bigint,
    recipient?: string,
  ): Promise<void> {
    const amnt = formatBN(amount, getDecimals(tokenAddr));
    let transactionHash: string | undefined;
    if (amount <= 10n) {
      this.log.debug(
        `skip swapping ${amount} ${tokenSymbolByAddress[tokenAddr]} back to ETH: amount to small`,
      );
      return;
    }
    try {
      if (tokenAddr.toLowerCase() === this.wethAddr.toLowerCase()) {
        // WETH is unwrapped during liquidation (convertWETH flag)
        return;
      }
      this.log.debug(
        `swapping ${amnt} ${tokenSymbolByAddress[tokenAddr]} back to ETH`,
      );
      const erc20 = IERC20__factory.connect(tokenAddr, executor);
      const approveTx = await erc20.approve(this.routerAddress, amount);
      await this.executor.mine(approveTx);

      const swap = await this.apiClient.get("/swap", {
        params: {
          src: tokenAddr,
          dst: ETH,
          amount: amount.toString(),
          from: executor.address,
          slippage: this.slippage,
          disableEstimate: true,
          allowPartialFill: false,
          receiver: recipient ?? executor.address,
        },
      });

      const {
        tx: { gas, gasPrice, ...tx },
        // ...rest
      } = swap.data;

      const txR = await executor.sendTransaction(tx);
      transactionHash = txR.hash;
      await this.executor.mine(txR);
      this.log.debug(
        `swapped ${amnt} ${tokenSymbolByAddress[tokenAddr]} back to ETH`,
      );
    } catch (e) {
      let info: any;
      if (axios.isAxiosError(e)) {
        info = e.response?.data?.description;
      }
      info = info || `${e}`;
      const error = new OneInchError(
        `failed to swap ${amnt} ${tokenSymbolByAddress[tokenAddr]} back to ETH: ${info}`,
      );
      error.transactionHash = transactionHash;
      throw error;
    }
  }
}
