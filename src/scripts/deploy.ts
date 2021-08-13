// @ts-ignore
import { ethers } from "hardhat";
import { Terminator__factory } from "../types/ethers-v5";
import fs from "fs";

async function deploy() {
  const terminatorFactory = (await ethers.getContractFactory(
    "Terminator"
  )) as Terminator__factory;

  console.log("Deploying price oracle");
  const terminator = await terminatorFactory.deploy();
  await terminator.deployed();
  console.log(`Price oracle deployed at ${terminator.address}`);

  console.log("Writing .env file");
  const envFile = `BOT_ADDRESS=${terminator.address}`;
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
