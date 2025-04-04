import type { CreditSuite } from "@gearbox-protocol/sdk";
import type { Address, Hash } from "viem";

export interface IPartialLiquidatorContract {
  address: Address;
  name: string;
  version: number;
  envVariables: Record<string, string>;
  addCreditManager: (cm: CreditSuite) => void;
  /**
   * Registers credit manager addresses in liquidator contract if necessary
   */
  configure: () => Promise<void>;
  /**
   * Deploys the liquidator contracts, if necessary
   */
  deploy: () => Promise<void>;
}

export interface IPartialLiqudatorContractFactory {
  tryAttach: (cm: CreditSuite) => IPartialLiquidatorContract | undefined;
}

export interface MerkleDistributorInfo {
  merkleRoot: Hash;
  tokenTotal: string;
  claims: Record<
    Address,
    {
      index: number;
      amount: string;
      proof: Hash[];
    }
  >;
}
