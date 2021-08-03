import { config as dotEnvConfig } from "dotenv";
import { HardhatUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-waffle";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-ethers";
import "hardhat-typechain";
import "hardhat-gas-reporter";
import "hardhat-abi-exporter";
import "hardhat-contract-sizer";
import "solidity-coverage";
// @ts-ignore
import { LOCAL_NETWORK, MAINNET_NETWORK } from "./src/core/constants";

// gets data from .env file
dotEnvConfig();

const INFURA_API_KEY = process.env.INFURA_API_KEY || "";
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "";
const KOVAN_PRIVATE_KEY =
  process.env.PRIVATE_KEY! ||
  "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3"; // well known private key

const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY;

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [{ version: "0.7.6", settings: {} }],
  },
  networks: {
    hardhat: {
      chainId: LOCAL_NETWORK,
    },
    localhost: {},
    mainnet: {
      url: `https://mainnet.infura.io/v3/${INFURA_API_KEY}`,
      accounts: [KOVAN_PRIVATE_KEY],
      chainId: MAINNET_NETWORK,
    },

    kovan: {
      url: process.env.ETH_PROVIDER_KOVAN,
      accounts: [KOVAN_PRIVATE_KEY],
    },

  },
  etherscan: {
    // Your API key for Etherscan
    // Obtain one at https://etherscan.io/
    apiKey: ETHERSCAN_API_KEY,
  },
  gasReporter: {
    enabled: false,
    currency: "USD",
    gasPrice: 21,
  },
  typechain: {
    outDir: "src/types/ethers-v5",
    target: "ethers-v5",
  },
  abiExporter: {
    path: "./abi",
    clear: true,
    flat: true,
    spacing: 2,
  },
  contractSizer: {
    alphaSort: false,
    disambiguatePaths: false,
    runOnCompile: true
  }
};

export default config;
