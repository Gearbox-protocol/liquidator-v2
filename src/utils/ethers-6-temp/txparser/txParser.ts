import type {
  ConvexPoolParams,
  NetworkType,
  SupportedContract,
  SupportedToken,
} from "@gearbox-protocol/sdk-gov";
import {
  AdapterInterface,
  contractParams,
  contractsByAddress,
  contractsByNetwork,
  tokenDataByNetwork,
  TypedObjectUtils,
} from "@gearbox-protocol/sdk-gov";
import type { MultiCall } from "@gearbox-protocol/types/v3";

import { AaveV2LendingPoolAdapterParser } from "./aaveV2LendingPoolAdapterParser";
import { AaveV2WrappedATokenAdapterParser } from "./aaveV2WrappedATokenAdapterParser";
import type { AbstractParser } from "./abstractParser";
import { AddressProviderParser } from "./addressProviderParser";
import { BalancerV2VaultParser } from "./balancerV2VaultParser";
import { CamelotV3AdapterParser } from "./camelotV3AdapterParser";
import { CompoundV2CTokenAdapterParser } from "./compoundV2CTokenAdapterParser";
import { ConvexBaseRewardPoolAdapterParser } from "./convexBaseRewardPoolAdapterParser";
import { ConvexBoosterAdapterParser } from "./convexBoosterAdapterParser";
import { ConvexRewardPoolParser } from "./convextRewardPoolParser";
import { CreditFacadeParser } from "./creditFacadeParser";
import { CreditManagerParser } from "./creditManagerParser";
import { CurveAdapterParser } from "./curveAdapterParser";
import { ERC20Parser } from "./ERC20Parser";
import { ERC4626AdapterParser } from "./erc626AdapterParser";
import type { IParser } from "./iParser";
import { LidoAdapterParser } from "./lidoAdapterParser";
import { LidoSTETHParser } from "./lidoSTETHParser";
import { PoolParser } from "./poolParser";
import { PriceOracleParser } from "./priceOracleParser";
import { UniswapV2AdapterParser } from "./uniV2AdapterParser";
import { UniswapV3AdapterParser } from "./uniV3AdapterParser";
import { VelodromeV2RouterAdapterParser } from "./velodromeV2RouterAdapterParser";
import { WstETHAdapterParser } from "./wstETHAdapterParser";
import { YearnV2AdapterParser } from "./yearnV2AdapterParser";

export interface AdapterForParser {
  adapter: string;
  contract: string;
}

interface ParseData {
  contract: string;
  adapterName: string;
}

export class TxParser {
  protected static parsers: Record<string, IParser & AbstractParser> = {};

  public static parse(address: string, calldata: string): string {
    const parser = TxParser.getParser(address);
    try {
      return parser.parse(calldata);
    } catch (e) {
      console.error(`Error while parsing ${address}`, parser, e);
      return "Parsing error";
    }
  }

  public static parseToObject(address: string, calldata: string) {
    const parser = TxParser.getParser(address);
    return parser.parseToObject(address, calldata);
  }

  public static getParseData(address: string): ParseData {
    const parser = TxParser.getParser(address);
    return { contract: parser.contract, adapterName: parser.adapterName };
  }

  public static parseMultiCall(calls: Array<MultiCall>): Array<string> {
    return calls.map(call =>
      TxParser.parse(call.target, call.callData.toString()),
    );
  }

  public static parseToObjectMultiCall(calls: Array<MultiCall>) {
    return calls.map(call =>
      TxParser.parseToObject(call.target, call.callData.toString()),
    );
  }

  public static addAdapters(adapters: Array<AdapterForParser>) {
    for (let a of adapters) {
      const contract = contractsByAddress[a.contract.toLowerCase()];
      if (contract && contractParams[contract]) {
        TxParser.chooseContractParser(
          a.adapter,
          contract,
          contractParams[contract].type,
          false,
        );
      } else {
        console.error(`Unknown address: ${contract} at ${a.contract}`);
      }
    }
  }

  public static addContracts(network: NetworkType) {
    TypedObjectUtils.entries(contractParams).forEach(
      ([contract, contractData]) => {
        const address = contractsByNetwork[network][contract];

        TxParser.chooseContractParser(
          address,
          contract,
          contractData.type,
          true,
        );

        if (contractData.type === AdapterInterface.CONVEX_V1_BASE_REWARD_POOL) {
          (contractData as ConvexPoolParams).extraRewards.forEach(r => {
            const extraAddress = r.poolAddress[network];

            TxParser._addParser(
              extraAddress,
              new ConvexRewardPoolParser(r.rewardToken),
            );
          });
        }
      },
    );
  }

  public static addCreditFacade(
    creditFacade: string,
    underlying: SupportedToken,
    version: number,
  ) {
    TxParser._addParser(
      creditFacade,
      new CreditFacadeParser(underlying, version),
    );
  }

  public static addTokens(network: NetworkType) {
    TypedObjectUtils.entries(tokenDataByNetwork[network]).forEach(([s, t]) => {
      if (s === "STETH") {
        TxParser._addParser(t, new LidoSTETHParser(s));
      } else {
        const contract = contractsByAddress[t.toLowerCase()];

        if (contract) {
          TxParser.chooseContractParser(
            t,
            contract,
            contractParams[contract].type,
            true,
          );
        } else {
          TxParser._addParser(t, new ERC20Parser(s));
        }
      }
    });
  }

  public static addPriceOracle(address: string) {
    TxParser._addParser(address, new PriceOracleParser());
  }

  public static addAddressProvider(address: string) {
    TxParser._addParser(address, new AddressProviderParser());
  }
  public static addCreditManager(address: string, version: number) {
    TxParser._addParser(address, new CreditManagerParser(version));
  }
  public static addPool(address: string, version: number) {
    TxParser._addParser(address, new PoolParser(version));
  }

  public static getParser(address: string) {
    const parser = TxParser.parsers[address.toLowerCase()];
    if (!parser) throw new Error(`Can't find parser for ${address}`);
    return parser;
  }

  protected static chooseContractParser(
    address: string,
    contract: SupportedContract,
    adapterType: number,
    isContract: boolean,
  ) {
    const addressLC = address.toLowerCase();
    switch (AdapterInterface[adapterType]) {
      case "UNISWAP_V2_ROUTER":
        TxParser._addParser(
          addressLC,
          new UniswapV2AdapterParser(contract, isContract),
        );
        break;

      case "UNISWAP_V3_ROUTER":
        TxParser._addParser(
          addressLC,
          new UniswapV3AdapterParser(contract, isContract),
        );
        break;

      case "CURVE_V1_EXCHANGE_ONLY":
      case "CURVE_V1_2ASSETS":
      case "CURVE_V1_3ASSETS":
      case "CURVE_V1_4ASSETS":
      case "CURVE_V1_STECRV_POOL":
      case "CURVE_V1_WRAPPER":
      case "CURVE_STABLE_NG":
        TxParser._addParser(
          addressLC,
          new CurveAdapterParser(contract, isContract),
        );
        break;

      case "YEARN_V2":
        TxParser._addParser(
          addressLC,
          new YearnV2AdapterParser(contract, isContract),
        );
        break;

      case "CONVEX_V1_BASE_REWARD_POOL":
        TxParser._addParser(
          addressLC,
          new ConvexBaseRewardPoolAdapterParser(contract, isContract),
        );
        break;

      case "CONVEX_V1_BOOSTER":
        TxParser._addParser(
          addressLC,
          new ConvexBoosterAdapterParser(contract, isContract),
        );
        break;

      case "CONVEX_V1_CLAIM_ZAP":
        break;

      case "LIDO_V1":
        TxParser._addParser(
          addressLC,
          new LidoAdapterParser(contract, isContract),
        );
        break;

      case "LIDO_WSTETH_V1":
        TxParser._addParser(
          addressLC,
          new WstETHAdapterParser(contract, isContract),
        );
        break;

      case "AAVE_V2_LENDING_POOL":
        TxParser._addParser(
          addressLC,
          new AaveV2LendingPoolAdapterParser(contract, isContract),
        );
        break;

      case "AAVE_V2_WRAPPED_ATOKEN":
        TxParser._addParser(
          addressLC,
          new AaveV2WrappedATokenAdapterParser(contract, isContract),
        );
        break;

      case "BALANCER_VAULT":
        TxParser._addParser(
          addressLC,
          new BalancerV2VaultParser(contract, isContract),
        );
        break;

      case "COMPOUND_V2_CERC20":
      case "COMPOUND_V2_CETHER":
        TxParser._addParser(
          addressLC,
          new CompoundV2CTokenAdapterParser(contract, isContract),
        );
        break;

      case "ERC4626_VAULT":
        TxParser._addParser(
          addressLC,
          new ERC4626AdapterParser(contract, isContract),
        );
        break;

      case "VELODROME_V2_ROUTER":
        TxParser._addParser(
          addressLC,
          new VelodromeV2RouterAdapterParser(contract, isContract),
        );
        break;

      case "CAMELOT_V3_ROUTER":
        TxParser._addParser(
          addressLC,
          new CamelotV3AdapterParser(contract, isContract),
        );
        break;
      // CONVEX_L2_BOOSTER = 25,
      // CONVEX_L2_REWARD_POOL = 26,
      // AAVE_V3_LENDING_POOL = 27
    }
  }

  protected static _addParser(
    address: string,
    parser: IParser & AbstractParser,
  ) {
    TxParser.parsers[address.toLowerCase()] = parser;
  }
}
