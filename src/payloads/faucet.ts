import { IsEthereumAddress, IsNotEmpty } from "class-validator";

export class FaucetPayload {
  @IsEthereumAddress()
  @IsNotEmpty()
  address: string;

  @IsEthereumAddress()
  @IsNotEmpty()
  token: string;

  @IsNotEmpty()
  signature: string;
}
