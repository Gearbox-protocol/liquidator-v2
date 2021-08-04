import { BigNumber } from "ethers";
import { ERC20 } from "../types/ethers-v5";

export class Token {
  public readonly address: string;
  public readonly symbol: string;
  public readonly decimals: number;

  protected _contract: ERC20;
  private static _botAddress: string;
  private _balance: BigNumber;

  static async newToken(address: string, contract: ERC20): Promise<Token> {
    const symbol = await contract.symbol();
    const decimals = await contract.decimals();
    const newToken = new Token({ address, contract, symbol, decimals });
    await newToken.updateBalance();
    return newToken;
  }

  protected constructor(opts: {
    address: string;
    symbol: string;
    decimals: number;
    contract: ERC20;
  }) {
    this.address = opts.address;
    this.symbol = opts.symbol;
    this.decimals = opts.decimals;
    this._contract = opts.contract;
  }

  async updateBalance(): Promise<BigNumber> {
    this._balance = await this._contract.balanceOf(Token._botAddress);
    return this._balance;
  }

  get balance(): BigNumber {
    return this._balance;
  }

  static set botAddress(value: string) {
    this._botAddress = value;
  }

  async transfer(recipient: string, amount: number) {
    const amountBN = BigNumber.from(10)
      .pow(this.decimals - 6)
      .mul(Math.floor(amount * 1e6));
    const receipt = await this._contract.transfer(recipient, amountBN, {gasLimit: 100000});
    await receipt.wait(2)
  }
}
