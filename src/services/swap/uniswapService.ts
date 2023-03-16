import {
  decimals,
  getDecimals,
  IERC20__factory,
  IWETH__factory,
  MAINNET_NETWORK,
  tokenDataByNetwork,
  tokenSymbolByAddress,
} from "@gearbox-protocol/sdk";
import {
  Currency,
  CurrencyAmount,
  Percent,
  Token,
  TradeType,
} from "@uniswap/sdk-core";
import IUniswapV3PoolABI from "@uniswap/v3-core/artifacts/contracts/interfaces/IUniswapV3Pool.sol/IUniswapV3Pool.json";
import {
  computePoolAddress,
  FeeAmount,
  Pool,
  Route,
  SwapOptions,
  SwapQuoter,
  SwapRouter,
  Trade,
} from "@uniswap/v3-sdk";
import { BigNumberish, ethers, Wallet } from "ethers";
import { Service } from "typedi";

import { Logger, LoggerInterface } from "../../decorators/logger";
import { ISwapper } from "./types";

type TokenTrade = Trade<Token, Token, TradeType>;

const WETH = new Token(
  MAINNET_NETWORK,
  tokenDataByNetwork.Mainnet.WETH,
  decimals.WETH,
  "WETH",
  "Wrapped Ether",
);

const QUOTER_CONTRACT_ADDRESS = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const POOL_FACTORY_CONTRACT_ADDRESS =
  "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const SWAP_ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

@Service()
export default class Uniswap implements ISwapper {
  @Logger("uniswap")
  log: LoggerInterface;

  // @ts-ignore
  public async swap(
    executor: Wallet,
    tokenAddr: string,
    amount: BigNumberish,
  ): Promise<void> {
    this.log.debug(`Swapping ${tokenSymbolByAddress[tokenAddr]} back to ETH`);
    try {
      const token = newToken(tokenAddr);
      const trade = await this.createTrade(executor, token, amount);
      await this.executeTrade(executor, token, amount, trade);
      await this.unwrap(executor);
      this.log.debug(`Swapped ${tokenSymbolByAddress[tokenAddr]} back to ETH`);
    } catch (e) {
      this.log.error(
        `Failed to swap ${tokenSymbolByAddress[tokenAddr]} back to ETH: ${e}`,
      );
    }
  }

  private async createTrade(
    executor: Wallet,
    token: Token,
    amount: BigNumberish,
  ): Promise<TokenTrade> {
    const pool = await this.getPool(executor, token);
    const swapRoute = new Route([pool], token, WETH);
    const amountOut = await this.getOutputQuote(
      executor,
      token,
      amount,
      swapRoute,
    );

    return Trade.createUncheckedTrade({
      route: swapRoute,
      inputAmount: CurrencyAmount.fromRawAmount(token, amount.toString()),
      outputAmount: CurrencyAmount.fromRawAmount(WETH, amountOut.toString()),
      tradeType: TradeType.EXACT_INPUT,
    });
  }

  private async executeTrade(
    executor: Wallet,
    token: Token,
    amount: BigNumberish,
    trade: TokenTrade,
  ): Promise<void> {
    const erc20 = IERC20__factory.connect(token.address, executor);
    await erc20.approve(SWAP_ROUTER_ADDRESS, amount);

    const options: SwapOptions = {
      slippageTolerance: new Percent(50, 10_000), // 50 bips, or 0.50%
      deadline: Math.floor(Date.now() / 1000) + 60 * 20, // 20 minutes from the current Unix time
      recipient: executor.address,
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

  private async unwrap(executor: Wallet): Promise<void> {
    const weth = IWETH__factory.connect(WETH.address, executor);
    const erc20 = IERC20__factory.connect(WETH.address, executor);
    const balance = await erc20.balanceOf(executor.address);
    await weth.withdraw(balance);
  }

  private async getPool(executor: Wallet, token: Token): Promise<Pool> {
    const currentPoolAddress = computePoolAddress({
      factoryAddress: POOL_FACTORY_CONTRACT_ADDRESS,
      tokenA: token,
      tokenB: WETH,
      fee: FeeAmount.MEDIUM,
    });

    const poolContract = new ethers.Contract(
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
      WETH,
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

    const [amountOut] = ethers.utils.defaultAbiCoder.decode(
      ["uint256"],
      quoteCallReturnData,
    );

    return amountOut;
  }
}

function newToken(addr: string): Token {
  return new Token(
    MAINNET_NETWORK,
    addr,
    getDecimals(tokenSymbolByAddress[addr]),
    tokenSymbolByAddress[addr],
    tokenSymbolByAddress[addr],
  );
}
