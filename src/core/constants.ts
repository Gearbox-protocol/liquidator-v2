import { BigNumber } from "ethers";

export const MAX_INT = BigNumber.from(
  "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
);
export const MAINNET_NETWORK = 1;
export const KOVAN_NETWORK = 42;
export const LOCAL_NETWORK = 1337;

export type NetworkType = "Mainnet" | "Kovan" | "Local";

export const RAY = BigNumber.from(10).pow(27);
export const halfRAY = RAY.div(2);
export const WAD = BigNumber.from(10).pow(18);

export const ACCOUNT_CREATION_REWARD = BigNumber.from(1e5);
export const DEPLOYMENT_COST = BigNumber.from(10).pow(17);
export const ADDRESS_0x0 = "0x0000000000000000000000000000000000000000";

export const PERCENTAGE_FACTOR = 1e4;

export const SECONDS_PER_YEAR = 365 * 24 * 3600;

// Used in tests
export const DUMB_ADDRESS = "0xC4375B7De8af5a38a93548eb8453a498222C4fF2";

export const OWNABLE_REVERT_MSG = "Ownable: caller is not the owner";
export const UNISWAP_EXPIRED = "UniswapV2Router: EXPIRED";
export const PAUSABLE_REVERT_MSG = "Pausable: paused";
export const PAUSABLE_NOT_PAUSED_REVERT_MSG = "Pausable: not paused";

export const FEE_SUCCESS = 100;
export const FEE_INTEREST = 1000;

export const FEE_LIQUIDATION = 200;

// For config parameters only
export const UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD_PARAM = 93;

export const UNDERLYING_TOKEN_LIQUIDATION_THRESHOLD = 9300;

export const LIQUIDATION_DISCOUNTED_SUM = 9500;
export const LEVERAGE_DECIMALS = 100;

export const CHI_THRESHOLD_DEFAULT = 9800;
export const CHI_THRESHOLD_MIN = 9500;
