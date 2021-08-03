// @ts-ignore
import { ethers } from "hardhat";

import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { KOVAN_NETWORK, MAX_INT, WAD } from "../core/constants";
import { ChainlinkOracleResult } from "../core/chainlinkOracle";
import { formatBN } from "../utils/formatter";
import {
  AggregatorV3Interface__factory,
  ERC20__factory,
  IUniswapV2Factory__factory,
  IUniswapV2Pair__factory,
  IUniswapV2Router02__factory
} from "../types/ethers-v5";
import { BigNumber } from "ethers";
import { UNISWAP_V2_ADDRESS, WETH_TOKEN } from "../config";
import { tokenData } from "../core/tokenData";

const SUSHISWAP_ADDRESS = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
const targetEthAmount = WAD.mul(5);

// export const tokensToMint = [
//   {
//     symbol: "AAVE",
//     name: "Aave Token",
//     decimals: 18,
//     priceFeed: "0xd04647B7CB523bb9f26730E9B6dE1174db7591Ad",
//   },
//   {
//     symbol: "LINK",
//     name: "ChainLink Token",
//     decimals: 18,
//     priceFeed: "0x3Af8C569ab77af5230596Acf0E8c2F9351d24C38",
//   },
//   {
//     symbol: "DAI",
//     name: "Dai Stablecoin",
//     decimals: 18,
//     priceFeed: "0x22B58f1EbEDfCA50feF632bD73368b2FdA96D541",
//   },
//   {
//     symbol: "SNX",
//     name: "Synthetix Network Token",
//     decimals: 18,
//     priceFeed: "0x31f93DA9823d737b7E44bdee0DF389Fe62Fd1AcD",
//   },
//   {
//     symbol: "UNI",
//     name: "Uniswap",
//     decimals: 18,
//     priceFeed: "0x17756515f112429471F86f98D5052aCB6C47f6ee",
//   },
//   {
//     symbol: "USDC",
//     name: "USD Coin",
//     decimals: 6,
//     priceFeed: "0x64EaC61A2DFda2c3Fa04eED49AA33D021AeC8838",
//   },
//   {
//     symbol: "ZRX",
//     name: "0x Protocol Token",
//     decimals: 18,
//     priceFeed: "0xBc3f28Ccc21E9b5856E81E6372aFf57307E2E883",
//   },
// ];

async function faucetMintTokens() {
  const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
  const chainId = await accounts[0].getChainId();
  if (chainId !== KOVAN_NETWORK) {
    throw new Error("Incorrect network");
  }
  const deployer = accounts[0];

  for (const routerAddress of [
    UNISWAP_V2_ADDRESS,
    SUSHISWAP_ADDRESS,
  ]) {
    console.log("ROUTER", routerAddress);

    const router = IUniswapV2Router02__factory.connect(routerAddress, deployer);

    for (const token of Object.entries(tokenData)) {
      const symbol = token[0];
      const tokenAddress = token[1].address;

      const contract = await ERC20__factory.connect(tokenAddress, deployer);

      const rAppr = await contract.approve(routerAddress, MAX_INT);
      await rAppr.wait();

      const priceFeed = await AggregatorV3Interface__factory.connect(
        token[1].priceFeed,
        deployer
      );

      const priceFeedDecimals = await priceFeed.decimals();
      const result: ChainlinkOracleResult = await priceFeed.latestRoundData();

      console.log(`${symbol}: ${formatBN(result.answer, priceFeedDecimals)}`);

      const decimals = await contract.decimals();

      const factoryAddress = await router.factory();

      const factory = IUniswapV2Factory__factory.connect(
        factoryAddress,
        deployer
      );

      const pairAddress = await factory.getPair(tokenAddress, WETH_TOKEN);

      const pair = IUniswapV2Pair__factory.connect(pairAddress, deployer);

      let wethAmount = BigNumber.from(0);
      let tokenAmount = BigNumber.from(0);

      try {
        const [res0, res1] = await pair.getReserves();

        wethAmount =
          tokenAddress.toLowerCase() < WETH_TOKEN.toLowerCase() ? res1 : res0;
        tokenAmount =
          tokenAddress.toLowerCase() < WETH_TOKEN.toLocaleLowerCase()
            ? res0
            : res1;
      } catch (e) {
        console.log(`${symbol}-ETH : doesnt exists`);
      }

      console.log(`${symbol}-ETH : WETH AT POOL:`, formatBN(wethAmount, 18));

      if (wethAmount.lt(targetEthAmount)) {
        const amountNeed = targetEthAmount.sub(wethAmount);

        console.log(tokenAmount.toString(), wethAmount.toString());

        const tokenAmountNeeded = wethAmount.isZero()
          ? amountNeed
              .mul(BigNumber.from(10).pow(priceFeedDecimals))
              .div(result.answer)
              .mul(BigNumber.from(10).pow(decimals))
              .div(BigNumber.from(10).pow(18))
          : amountNeed.mul(tokenAmount).div(wethAmount);

        console.log(
          formatBN(amountNeed, 18),
          formatBN(tokenAmountNeeded, decimals)
        );

        const deadline = Math.floor(Date.now() / 1000) + 600;
        const receipt = await router.addLiquidityETH(
          tokenAddress,
          tokenAmountNeeded,
          0,//tokenAmountNeeded.div(2),
            0, //amountNeed,
          deployer.address,
          deadline,
          { value: amountNeed.mul(11).div(10) }
        );

        await receipt.wait();
      } else {
        console.log("Nothing to add");
      }
    }
  }
}

faucetMintTokens()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
