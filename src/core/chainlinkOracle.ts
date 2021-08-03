import { BigNumber } from "ethers";

export interface ChainlinkOracleResult {
  roundId: BigNumber;
  answer: BigNumber;
  startedAt: BigNumber;
  updatedAt: BigNumber;
  answeredInRound: BigNumber;
}
