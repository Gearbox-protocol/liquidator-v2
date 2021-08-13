import { BigNumber } from "ethers";

export interface TradePath {
  path: string[];
  amountOutMin: BigNumber;
}
