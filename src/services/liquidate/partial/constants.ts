import type { NetworkType } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

export const AAVE_V3_LENDING_POOL: Partial<Record<NetworkType, Address>> = {
  Mainnet: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  Arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  Optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  Base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  BNB: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB",
  Etherlink: "0x3bD16D195786fb2F509f2E2D7F69920262EF114D",
  Plasma: "0x925a2A7214Ed92428B5b1B090F80b25700095e12",
};

export const FLASH_MINTERS: Partial<
  Record<NetworkType, Record<string, Address>>
> = {
  Mainnet: {
    GHO: "0xb639D208Bcf0589D54FaC24E655C79EC529762B8",
    DOLA: "0x6C5Fdc0c53b122Ae0f15a863C349f3A481DE8f1F",
  },
  Berachain: {
    NECT: "0x1ce0a25d13ce4d52071ae7e02cf1f6606f4c79d3",
  },
};

export const SONIC_USDCE_SILO: Address =
  "0x322e1d5384aa4ED66AeCa770B95686271de61dc3";
export const SONIC_WS_SILO: Address =
  "0xf55902DE87Bd80c6a35614b48d7f8B612a083C12";

export const MORPHO: Partial<Record<NetworkType, Address>> = {
  Monad: "0xD5D960E8C380B724a48AC59E2DfF1b2CB4a1eAee",
};
