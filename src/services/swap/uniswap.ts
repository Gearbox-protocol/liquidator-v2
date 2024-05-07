import type { NetworkType } from "@gearbox-protocol/sdk-gov";
import {
  CHAINS,
  decimals,
  getDecimals,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk-gov";
import { IERC20__factory } from "@gearbox-protocol/types/v3";
import type { Currency } from "@uniswap/sdk-core";
import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
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
import { AbiCoder, type BigNumberish, Contract, type Wallet } from "ethers";
import { Service } from "typedi";

import { Logger, type LoggerInterface } from "../../log";
import BaseSwapper from "./base";
import type { ISwapper } from "./types";

const QUOTER_CONTRACT_ADDRESS = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const POOL_FACTORY_CONTRACT_ADDRESS =
  "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const SWAP_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

@Service()
export default class Uniswap extends BaseSwapper implements ISwapper {
  @Logger("uniswap")
  log: LoggerInterface;

  private WETH: Token;

  public async launch(network: NetworkType): Promise<void> {
    await super.launch(network);
    this.WETH = new Token(
      CHAINS[network],
      this.wethAddr,
      decimals.WETH,
      "WETH",
      "Wrapped Ether",
    );
  }

  public async swap(
    executor: Wallet,
    tokenAddr: string,
    amount: bigint,
    recipient?: string,
  ): Promise<void> {
    if (amount <= 10n) {
      this.log.debug(
        `skip swapping ${amount} ${tokenSymbolByAddress[tokenAddr]} back to ETH: amount to small`,
      );
      return;
    }
    try {
      if (tokenAddr.toLowerCase() !== this.wethAddr.toLowerCase()) {
        this.log.debug(
          `swapping ${tokenSymbolByAddress[tokenAddr]} back to ETH`,
        );
        await this.executeTrade(executor, tokenAddr, amount);
        this.log.debug(`swapped ${tokenSymbolByAddress[tokenAddr]} to WETH`);
      }
      this.log.debug("unwrapped ETH");
    } catch (e) {
      this.log.error(
        `gailed to swap ${tokenSymbolByAddress[tokenAddr]} back to ETH: ${e}`,
      );
    }
  }

  private async executeTrade(
    executor: Wallet,
    tokenAddr: string,
    amount: BigNumberish,
    recipient?: string,
  ): Promise<void> {
    const token = new Token(
      CHAINS[this.network],
      tokenAddr,
      getDecimals(tokenAddr),
      tokenSymbolByAddress[tokenAddr],
      tokenSymbolByAddress[tokenAddr],
    );

    const pool = await this.getPool(executor, token);
    const swapRoute = new Route([pool], token, this.WETH);
    const amountOut = await this.getOutputQuote(
      executor,
      token,
      amount,
      swapRoute,
    );

    const trade = Trade.createUncheckedTrade({
      route: swapRoute,
      inputAmount: CurrencyAmount.fromRawAmount(token, amount.toString()),
      outputAmount: CurrencyAmount.fromRawAmount(
        this.WETH,
        amountOut.toString(),
      ),
      tradeType: TradeType.EXACT_INPUT,
    });

    const erc20 = IERC20__factory.connect(token.address, executor);
    await erc20.approve(SWAP_ROUTER_ADDRESS, amount);

    const options: SwapOptions = {
      slippageTolerance: new Percent(50, 10_000), // 50 bips, or 0.50%
      deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes from the current Unix time
      recipient: recipient ?? executor.address,
    };

    const methodParameters = SwapRouter.swapCallParameters([trade], options);

    const tx = {
      data: methodParameters.calldata,
      to: SWAP_ROUTER_ADDRESS,
      value: methodParameters.value,
      from: executor.address,
    };

    await executor.sendTransaction(tx);
  }

  private async getPool(executor: Wallet, token: Token): Promise<Pool> {
    const currentPoolAddress = computePoolAddress({
      factoryAddress: POOL_FACTORY_CONTRACT_ADDRESS,
      tokenA: token,
      tokenB: this.WETH,
      fee: FeeAmount.MEDIUM,
    });

    const poolContract = new Contract(
      currentPoolAddress,
      IUniswapV3PoolABI.abi,
      executor,
    );

    const [liquidity, slot0] = await Promise.all([
      poolContract.liquidity(),
      poolContract.slot0(),
    ]);

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
    executor: Wallet,
    token: Token,
    amount: BigNumberish,
    route: Route<Currency, Currency>,
  ): Promise<BigNumberish> {
    const { calldata } = SwapQuoter.quoteCallParameters(
      route,
      CurrencyAmount.fromRawAmount(token, amount.toString()),
      TradeType.EXACT_INPUT,
      {
        useQuoterV2: true,
      },
    );

    const quoteCallReturnData = await executor.call({
      to: QUOTER_CONTRACT_ADDRESS,
      data: calldata,
    });

    const [amountOut] = AbiCoder.defaultAbiCoder().decode(
      ["uint256"],
      quoteCallReturnData,
    );

    return amountOut;
  }
}
