import { chains, formatBN, type NetworkType } from "@gearbox-protocol/sdk";
import type { AxiosInstance } from "axios";
import axios from "axios";
import axiosRetry from "axios-retry";
import { type Address, erc20Abi } from "viem";

import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import BaseSwapper from "./base.js";
import type { ISwapper } from "./types.js";

const ETH = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

class OneInchError extends Error {
  transactionHash?: string;
}

export default class OneInch extends BaseSwapper implements ISwapper {
  @Logger("one_inch")
  log!: ILogger;

  private apiClient!: AxiosInstance;
  private readonly slippage: number;
  private routerAddress: Address = "0x111111125421cA6dc452d289314280a0f8842A65";

  constructor(slippage = 2) {
    super();
    this.slippage = slippage;
  }

  public async launch(network: NetworkType): Promise<void> {
    await super.launch(network);
    if (!this.config.oneInchApiKey) {
      throw new Error("1inch API key not provided");
    }
    const baseURL = `https://api.1inch.dev/swap/v6.0/${chains[network].id}`;
    this.apiClient = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${this.config.oneInchApiKey.value}`,
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

  public async swap(tokenAddr: Address, amount: bigint): Promise<void> {
    const [symb, decimals] = [
      this.creditAccountService.sdk.tokensMeta.symbol(tokenAddr),
      this.creditAccountService.sdk.tokensMeta.decimals(tokenAddr),
    ];

    const amnt = formatBN(amount, decimals);
    let transactionHash: string | undefined;
    if (amount <= 10n) {
      this.log.debug(
        `skip swapping ${amount} ${symb} back to ETH: amount to small`,
      );
      return;
    }
    try {
      if (tokenAddr.toLowerCase() === this.wethAddr.toLowerCase()) {
        // WETH is unwrapped during liquidation (convertWETH flag)
        return;
      }
      this.log.debug(`swapping ${amnt} ${symb} back to ETH`);
      await this.client.simulateAndWrite({
        abi: erc20Abi,
        address: tokenAddr,
        functionName: "approve",
        args: [this.routerAddress, amount],
      });

      const swap = await this.apiClient.get("/swap", {
        params: {
          src: tokenAddr,
          dst: ETH,
          amount: amount.toString(),
          from: this.client.address,
          slippage: this.slippage,
          disableEstimate: true,
          allowPartialFill: false,
          receiver: this.client.address,
        },
      });

      // TODO: this was not tested after viem rewrite
      const {
        tx: { gas, gasPrice, ...tx },
        // ...rest
      } = swap.data;
      const transactionHash = await this.client.wallet.sendTransaction(tx);
      await this.client.pub.waitForTransactionReceipt({
        hash: transactionHash,
        timeout: 120_000,
      });
      this.log.debug(`swapped ${amnt} ${symb} back to ETH`);
    } catch (e) {
      let info: any;
      if (axios.isAxiosError(e)) {
        info = e.response?.data?.description;
      }
      info = info || `${e}`;
      const error = new OneInchError(
        `failed to swap ${amnt} ${symb} back to ETH: ${info}`,
      );
      error.transactionHash = transactionHash;
      throw error;
    }
  }
}
