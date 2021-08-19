/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import {
  ethers,
  EventFilter,
  Signer,
  BigNumber,
  BigNumberish,
  PopulatedTransaction,
  BaseContract,
  ContractTransaction,
  Overrides,
  CallOverrides,
} from "ethers";
import { BytesLike } from "@ethersproject/bytes";
import { Listener, Provider } from "@ethersproject/providers";
import { FunctionFragment, EventFragment, Result } from "@ethersproject/abi";
import { TypedEventFilter, TypedEvent, TypedListener } from "./commons";

interface IPriceOracleInterface extends ethers.utils.Interface {
  functions: {
    "addPriceFeed(address,address)": FunctionFragment;
    "convert(uint256,address,address)": FunctionFragment;
    "getLastPrice(address,address)": FunctionFragment;
  };

  encodeFunctionData(
    functionFragment: "addPriceFeed",
    values: [string, string]
  ): string;
  encodeFunctionData(
    functionFragment: "convert",
    values: [BigNumberish, string, string]
  ): string;
  encodeFunctionData(
    functionFragment: "getLastPrice",
    values: [string, string]
  ): string;

  decodeFunctionResult(
    functionFragment: "addPriceFeed",
    data: BytesLike
  ): Result;
  decodeFunctionResult(functionFragment: "convert", data: BytesLike): Result;
  decodeFunctionResult(
    functionFragment: "getLastPrice",
    data: BytesLike
  ): Result;

  events: {
    "NewPriceFeed(address,address)": EventFragment;
  };

  getEvent(nameOrSignatureOrTopic: "NewPriceFeed"): EventFragment;
}

export class IPriceOracle extends BaseContract {
  connect(signerOrProvider: Signer | Provider | string): this;
  attach(addressOrName: string): this;
  deployed(): Promise<this>;

  listeners<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter?: TypedEventFilter<EventArgsArray, EventArgsObject>
  ): Array<TypedListener<EventArgsArray, EventArgsObject>>;
  off<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  on<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  once<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  removeListener<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>,
    listener: TypedListener<EventArgsArray, EventArgsObject>
  ): this;
  removeAllListeners<EventArgsArray extends Array<any>, EventArgsObject>(
    eventFilter: TypedEventFilter<EventArgsArray, EventArgsObject>
  ): this;

  listeners(eventName?: string): Array<Listener>;
  off(eventName: string, listener: Listener): this;
  on(eventName: string, listener: Listener): this;
  once(eventName: string, listener: Listener): this;
  removeListener(eventName: string, listener: Listener): this;
  removeAllListeners(eventName?: string): this;

  queryFilter<EventArgsArray extends Array<any>, EventArgsObject>(
    event: TypedEventFilter<EventArgsArray, EventArgsObject>,
    fromBlockOrBlockhash?: string | number | undefined,
    toBlock?: string | number | undefined
  ): Promise<Array<TypedEvent<EventArgsArray & EventArgsObject>>>;

  interface: IPriceOracleInterface;

  functions: {
    addPriceFeed(
      token: string,
      priceFeedToken: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<ContractTransaction>;

    convert(
      amount: BigNumberish,
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<[BigNumber]>;

    getLastPrice(
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<[BigNumber]>;
  };

  addPriceFeed(
    token: string,
    priceFeedToken: string,
    overrides?: Overrides & { from?: string | Promise<string> }
  ): Promise<ContractTransaction>;

  convert(
    amount: BigNumberish,
    tokenFrom: string,
    tokenTo: string,
    overrides?: CallOverrides
  ): Promise<BigNumber>;

  getLastPrice(
    tokenFrom: string,
    tokenTo: string,
    overrides?: CallOverrides
  ): Promise<BigNumber>;

  callStatic: {
    addPriceFeed(
      token: string,
      priceFeedToken: string,
      overrides?: CallOverrides
    ): Promise<void>;

    convert(
      amount: BigNumberish,
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    getLastPrice(
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;
  };

  filters: {
    NewPriceFeed(
      token?: string | null,
      priceFeed?: string | null
    ): TypedEventFilter<[string, string], { token: string; priceFeed: string }>;
  };

  estimateGas: {
    addPriceFeed(
      token: string,
      priceFeedToken: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<BigNumber>;

    convert(
      amount: BigNumberish,
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;

    getLastPrice(
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<BigNumber>;
  };

  populateTransaction: {
    addPriceFeed(
      token: string,
      priceFeedToken: string,
      overrides?: Overrides & { from?: string | Promise<string> }
    ): Promise<PopulatedTransaction>;

    convert(
      amount: BigNumberish,
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;

    getLastPrice(
      tokenFrom: string,
      tokenTo: string,
      overrides?: CallOverrides
    ): Promise<PopulatedTransaction>;
  };
}
