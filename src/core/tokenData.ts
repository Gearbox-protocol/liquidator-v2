export interface TokenData {
  address: string;
  priceFeed: string;
}

// AMPL  WBTC  REP  LINK  DAI  SNX  USDC  ZRX

export const tokenData: Record<string, TokenData> = {
  AMPL: {
    address: "0xAE50dDb8F26249a8Fd53796850679D9162949Cb0",
    priceFeed: "0x562C092bEb3a6DF77aDf0BB604F52c018E4f2814",
  },
  WBTC: {
    address: "0xE36bC5d8b689AD6d80e78c3e736670e80d4b329D",
    priceFeed: "0xF7904a295A029a3aBDFFB6F12755974a958C7C25",
  },
  REP: {
    address: "0x633317172c0D41451F62025D73CE59065A370a50",
    priceFeed: "0x3A7e6117F2979EFf81855de32819FBba48a63e9e",
  },
  LINK: {
    address: "0x6C994935826574E870549F09efF43BA8089A3D25",
    priceFeed: "0x3Af8C569ab77af5230596Acf0E8c2F9351d24C38",
  },
  DAI: {
    address: "0x9DC7B33C3B63fc00ed5472fBD7813eDDa6a64752",
    priceFeed: "0x22B58f1EbEDfCA50feF632bD73368b2FdA96D541",
  },
  SNX: {
    address: "0xB48891df9267EF65AABd32F497F6F2d1eB22A186",
    priceFeed: "0xF9A76ae7a1075Fe7d646b06fF05Bd48b9FA5582e",
  },

  USDC: {
    address: "0x31EeB2d0F9B6fD8642914aB10F4dD473677D80df",
    priceFeed: "0x64EaC61A2DFda2c3Fa04eED49AA33D021AeC8838",
  },

  ZRX: {
    address: "0xB730c1449c58f29C69df33ccD5bd9d3cA66b23C1",
    priceFeed: "0xBc3f28Ccc21E9b5856E81E6372aFf57307E2E883",
  },
};
