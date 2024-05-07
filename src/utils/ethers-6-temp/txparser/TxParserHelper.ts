import { ADDRESS_0X0, tokenSymbolByAddress } from "@gearbox-protocol/sdk-gov";

import type { CreditManagerData } from "../CreditManagerData";
import { TxParser } from "./txParser";

export class TxParserHelper {
  /**
   * This is helper for legacy code
   * in old versions of "@gearbox-protocol/sdk" where TxParser originally lives, this code is called from CreditManagerData constructor (!!)
   * @param cm
   */
  public static addCreditManager(cm: CreditManagerData): void {
    TxParser.addCreditManager(cm.address, cm.version);

    if (cm.creditFacade !== "" && cm.creditFacade !== ADDRESS_0X0) {
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
}
