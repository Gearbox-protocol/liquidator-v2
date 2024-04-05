import type { CreditAccountData } from "@gearbox-protocol/sdk";

import { managerName } from "./managerName";

export function accountName(ca: CreditAccountData): string {
  return `${ca.addr} of ${ca.borrower} in ${managerName(ca)})`;
}
