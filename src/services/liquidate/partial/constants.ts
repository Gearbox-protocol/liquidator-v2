import type { NetworkType } from "@gearbox-protocol/sdk";
import { NOT_DEPLOYED } from "@gearbox-protocol/sdk";
import type { Address } from "viem";

export const AAVE_V3_LENDING_POOL: Record<NetworkType, Address> = {
  Mainnet: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
  Arbitrum: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  Optimism: "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  Base: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
  Sonic: NOT_DEPLOYED,
  MegaETH: NOT_DEPLOYED,
  Monad: NOT_DEPLOYED,
  Berachain: NOT_DEPLOYED,
  Avalanche: NOT_DEPLOYED,
};

export const FLASH_MINTERS: Partial<
  Record<NetworkType, Record<string, Address>>
> = {
  Mainnet: {
    GHO: "0xb639D208Bcf0589D54FaC24E655C79EC529762B8",
    DOLA: "0x6C5Fdc0c53b122Ae0f15a863C349f3A481DE8f1F",
  },
};

export const SONIC_USDCE_SILO: Address =
  "0x322e1d5384aa4ED66AeCa770B95686271de61dc3";
export const SONIC_WS_SILO: Address =
  "0xf55902DE87Bd80c6a35614b48d7f8B612a083C12";
