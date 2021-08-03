// @ts-ignore
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { ArbBot__factory, PriceOracle__factory } from "../types/ethers-v5";
import { SUSHISWAP_ADDRESS, UNISWAP_V2_ADDRESS, WETH_TOKEN } from "../config";
import { tokenData } from "../core/tokenData";
import fs from "fs";

async function deploy() {
  // Gets accounts
  const accounts = (await ethers.getSigners()) as Array<SignerWithAddress>;
  const deployer = accounts[0];

  const priceOracleFactory = (await ethers.getContractFactory(
    "PriceOracle"
  )) as PriceOracle__factory;

  console.log("Deploying price oracle");
  const priceOracle = await priceOracleFactory.deploy(WETH_TOKEN);
  await priceOracle.deployed();
  console.log(`Price oracle deployed at ${priceOracle.address}`);

  for (const token of Object.entries(tokenData.Kovan)) {
    console.log(`Adding pricefeed for ${token[0]}`);
    const receipt = await priceOracle.addPriceFeed(
      token[1].address,
      token[1].priceFeed
    );
    await receipt.wait();
  }

  console.log("Deploying arbitrage bot contract");
  const botFactory = (await ethers.getContractFactory(
    "ArbBot"
  )) as ArbBot__factory;

  const arbBot = await botFactory.deploy(priceOracle.address);
  await arbBot.deployed();

  console.log(`Arbbot deployed at ${arbBot.address}`);

  console.log("Connecting routers");
  for (const router of [UNISWAP_V2_ADDRESS, SUSHISWAP_ADDRESS]) {
    const receipt = await arbBot.allowRouter(router);
    await receipt.wait;
  }

  console.log("Writing .env file");
  const envFile = `BOT_ADDRESS=${arbBot.address}`;
  fs.writeFileSync("./.env.local", envFile);
}

deploy()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
