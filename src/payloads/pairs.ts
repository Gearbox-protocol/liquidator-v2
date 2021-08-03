
export interface PairPayload {
  rate: number;
  rateCL: number;
  ratio: number;
  lastUpdate: number;
}

export interface TokenPayload {
  address: string;
  symbol: string;
  tokenBalance: string;
  chainLinkUpdate: number;
  pairs: Record<string, PairPayload>
}
