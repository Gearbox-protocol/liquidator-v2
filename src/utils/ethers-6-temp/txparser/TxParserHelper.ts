import { ADDRESS_0X0, tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";
import type { MultiCall } from "@gearbox-protocol/types/v3";

import type { CreditManagerData } from "../../../data/index.js";
import { TxParser } from "./txParser.js";

export class TxParserHelper {
  /**
   * This is helper for legacy code
   * in old versions of "@gearbox-protocol/sdk" where TxParser originally lives, this code is called from CreditManagerData constructor (!!)
   * @param cm
   */
  public static addCreditManager(cm: CreditManagerData): void {
    TxParser.addCreditManager(cm.address, cm.version);

    if (!!cm.creditFacade && cm.creditFacade !== ADDRESS_0X0) {
      TxParser.addCreditFacade(
        cm.creditFacade,
        tokenSymbolByAddress[cm.underlyingToken],
        cm.version,
      );

      TxParser.addAdapters(
        Object.entries(cm.adapters).map(([contract, adapter]) => ({
          adapter,
          contract: contract,
        })),
      );
    }
  }

  public static parseMultiCall(preview: { calls: MultiCall[] }): string[] {
    try {
      return TxParser.parseMultiCall(preview.calls);
    } catch (e) {
      return [`${e}`];
    }
  }
}
