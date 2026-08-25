import type {
  ExecutionReport,
  TrackReport,
} from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import type { Address } from "viem";
import type { INotification } from "../notifier";

export interface ICheck {
  name: string;
  check: (
    report: ExecutionReport,
    curator?: CuratorName,
  ) => Promise<INotification | undefined>;
}

/**
 * LiquidatorInstance contains information about different liqudation service instances
 */
export interface LiquidatorInstance {
  /**
   * Configuration id, e.g. "partial" or "deleverage"
   */
  id: string;
  /**
   * Human-readable for this id
   */
  name: string;
  /**
   * Address of EOA that this instance uses to perform liquidations
   */
  address: Address;
}

export type TrackFilter = (track?: TrackReport) => boolean;
