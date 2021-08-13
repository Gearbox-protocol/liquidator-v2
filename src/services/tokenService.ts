import { TokenData } from "@diesellabs/gearbox-sdk";
import { Service } from "typedi";
import { ERC20, ERC20__factory } from "../types/ethers-v5";
import { BigNumber, Signer } from "ethers";
import { Logger, LoggerInterface } from "../decorators/logger";

@Service()
export class TokenService {
  @Logger("TokenService")
  log: LoggerInterface;

  private readonly _tokenData: Record<string, TokenData> = {};
  public readonly _tokenContract: Record<string, ERC20> = {};
  public readonly _balance: Record<string, BigNumber> = {};

  protected _terminatorAddress: string;
  protected _signer: Signer;

  async launch(terminatorAddress: string, signer: Signer, wethToken: string) {
    this._terminatorAddress = terminatorAddress;
    this._signer = signer;
    await this.addToken(wethToken);
  }

  async addToken(address: string) {
    if (!this._terminatorAddress || !this._signer) {
      throw new Error("terminator or signer is not set");
    }

    if (this._tokenData[address]) return;
    const contract = ERC20__factory.connect(address, this._signer);

    const [symbol, decimals, balance] = await Promise.all([
      contract.symbol(),
      contract.decimals(),
      contract.balanceOf(this._terminatorAddress),
    ]);

    this.log.info(`Adding ${symbol}...`);

    this._tokenContract[address] = contract;
    this._tokenData[address] = new TokenData({
      addr: address,
      decimals,
      symbol,
    });
    this._balance[address] = balance;

    // Subscribing for balance updates
    contract.on(
      contract.filters.Transfer(this._terminatorAddress),
      async () => {
        this._balance[address] = await contract.balanceOf(
          this._terminatorAddress
        );
      }
    );

    contract.on(
      contract.filters.Transfer(null, this._terminatorAddress),
      async () => {
        this._balance[address] = await contract.balanceOf(
          this._terminatorAddress
        );
      }
    );
  }

  symbol(address: string): string | undefined {
    return this._tokenData[address]
      ? this._tokenData[address].symbol
      : undefined;
  }

  decimals(address: string): number {
    const tokenData = this._tokenData[address];
    if (!tokenData) throw new Error(`Can find token data for ${address}`);
    return tokenData.decimals;
  }
}
