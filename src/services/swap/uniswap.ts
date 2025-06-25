import { chains, type NetworkType } from "@gearbox-protocol/sdk";
import { ierc20MetadataAbi } from "@gearbox-protocol/types/abi";
import type { Currency } from "@uniswap/sdk-core";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json" with {
  type: "json",
};
import type { SwapOptions } from "@uniswap/v3-sdk";
import {
  computePoolAddress,
  FeeAmount,
  Pool,
  Route,
  SwapQuoter,
  SwapRouter,
  Trade,
} from "@uniswap/v3-sdk";
import type { Address, Hex } from "viem";
import {
  decodeAbiParameters,
  fromHex,
  getContract,
  parseAbiParameters,
} from "viem";

import type { ILogger } from "../../log/index.js";
import { Logger } from "../../log/index.js";
import BaseSwapper from "./base.js";
import type { ISwapper } from "./types.js";

const QUOTER_CONTRACT_ADDRESS: Address =
  "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const POOL_FACTORY_CONTRACT_ADDRESS: Address =
  "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const SWAP_ROUTER_ADDRESS: Address =
  "0xE592427A0AEce92De3Edee1F18E0157C05861564";

export default class Uniswap extends BaseSwapper implements ISwapper {
  @Logger("uniswap")
  log!: ILogger;

  private WETH!: Token;

  // TODO: this was not tested after View rewrite
  public async launch(network: NetworkType): Promise<void> {
    await super.launch(network);
    this.WETH = new Token(
      chains[network].id,
      this.wethAddr,
      18,
      "WETH",
      "Wrapped Ether",
    );
  }

  public async swap(tokenAddr: Address, amount: bigint): Promise<void> {
    const symb = this.creditAccountService.sdk.tokensMeta.symbol(tokenAddr);
    if (amount <= 10n) {
      this.log.debug(
        `skip swapping ${amount} ${symb} back to ETH: amount to small`,
      );
      return;
    }
    try {
      if (tokenAddr.toLowerCase() !== this.wethAddr.toLowerCase()) {
        this.log.debug(`swapping ${symb} back to ETH`);
        await this.executeTrade(tokenAddr, amount);
        this.log.debug(`swapped ${symb} to WETH`);
      }
      this.log.debug("unwrapped ETH");
    } catch (e) {
      this.log.error(`gailed to swap ${symb} back to ETH: ${e}`);
    }
  }

  private async executeTrade(
    tokenAddr: Address,
    amount: bigint,
  ): Promise<void> {
    const [symb, decimals] = [
      this.creditAccountService.sdk.tokensMeta.symbol(tokenAddr),
      this.creditAccountService.sdk.tokensMeta.decimals(tokenAddr),
    ];
    const token = new Token(
      chains[this.network].id,
      tokenAddr,
      decimals,
      symb,
      symb,
    );

    const pool = await this.getPool(token);
    const swapRoute = new Route([pool], token, this.WETH);
    const amountOut = await this.getOutputQuote(token, amount, swapRoute);

    const trade = Trade.createUncheckedTrade({
      route: swapRoute,
      inputAmount: CurrencyAmount.fromRawAmount(token, amount.toString()),
      outputAmount: CurrencyAmount.fromRawAmount(
        this.WETH,
        amountOut.toString(),
      ),
      tradeType: TradeType.EXACT_INPUT,
    });

    await this.client.simulateAndWrite({
      address: token.address as Address,
      abi: ierc20MetadataAbi,
      functionName: "approve",
      args: [SWAP_ROUTER_ADDRESS, amount],
    });

    const options: SwapOptions = {
      slippageTolerance: new Percent(50, 10_000), // 50 bips, or 0.50%
      deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes from the current Unix time
      recipient: this.client.address,
    };

    const methodParameters = SwapRouter.swapCallParameters([trade], options);

    await this.client.wallet.sendTransaction({
      data: methodParameters.calldata as Hex,
      to: SWAP_ROUTER_ADDRESS,
      value: fromHex(methodParameters.value as Hex, "bigint"),
      from: this.client.address,
    });
  }

  private async getPool(token: Token): Promise<Pool> {
    const currentPoolAddress = computePoolAddress({
      factoryAddress: POOL_FACTORY_CONTRACT_ADDRESS,
      tokenA: token,
      tokenB: this.WETH,
      fee: FeeAmount.MEDIUM,
    }) as Address;

    const poolContract = getContract({
      abi: IUniswapV3PoolABI.abi,
      address: currentPoolAddress,
      client: this.client.pub,
    });

    const [liquidity, slot0] = (await Promise.all([
      poolContract.read.liquidity(),
      poolContract.read.slot0(),
    ])) as [any, any];

    return new Pool(
      token,
      this.WETH,
      FeeAmount.MEDIUM,
      slot0[0].toString(),
      liquidity,
      slot0[1],
    );
  }

  private async getOutputQuote(
    token: Token,
    amount: bigint,
    route: Route<Currency, Currency>,
  ): Promise<bigint> {
    const { calldata } = SwapQuoter.quoteCallParameters(
      route,
      CurrencyAmount.fromRawAmount(token, amount.toString()),
      TradeType.EXACT_INPUT,
      {
        useQuoterV2: true,
      },
    );
    const { data: quoteCallReturnData } = await this.client.pub.call({
      to: QUOTER_CONTRACT_ADDRESS,
      data: calldata as Hex,
    });

    const [amountOut] = decodeAbiParameters(
      parseAbiParameters("uint256"),
      quoteCallReturnData!,
    );

    return amountOut;
  }
}
