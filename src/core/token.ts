import { BigNumber } from "ethers";
import {
  AggregatorV3Interface,
  ERC20,
  ERC20__factory,
} from "../types/ethers-v5";
import { Signer } from "crypto";
import { resolveSrv } from "dns";

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
    await newToken.updateBalance()
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
}
