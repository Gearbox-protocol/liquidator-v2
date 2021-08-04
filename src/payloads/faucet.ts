import { IsEthereumAddress, IsNotEmpty } from "class-validator";

export class FaucetRequest {
  @IsEthereumAddress()
  @IsNotEmpty()
  address: string;

  @IsEthereumAddress()
  @IsNotEmpty()
  token: string;

  @IsNotEmpty()
  signature: string;
}

export class FaucetResponse {
  symbol: string;
  address: string;
  delay: number;
  rate?: number;
  faucetSize: number;
}

export interface EthDelayPayload {
  delay: number;
}
