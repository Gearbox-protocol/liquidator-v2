import type {
  ExecutionReport,
  TrackRole,
} from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import type { Logger as ILogger } from "pino";
import DI from "../di";
import { Logger } from "../logger";
import type { INotification } from "../notifier";
import type { TypedSDK } from "../types";
import { CheckCoverage } from "./CheckCoverage";
import { CheckLiquidationDiscount } from "./CheckLiquidationDiscount";
import { CheckPermissions } from "./CheckPermissions";
import { CheckZeroDiscovery } from "./CheckZeroDiscovery";
import type { ICheck } from "./types";

export class ExecutionAnalyzer {
  @Logger("ExecutionAnalyzer")
  public readonly logger!: ILogger;

  @DI.Inject(DI.SDK)
  public readonly sdk!: TypedSDK;

  #executionChecks: ICheck[] = [
    // new CheckParity(), // TODO: this is unusable for now
    new CheckPermissions(),
    new CheckLiquidationDiscount(),
  ];

  #roleChecks: Record<TrackRole, ICheck[]> = {
    service: [
      new CheckZeroDiscovery({ severe: true }),
      new CheckCoverage({ title: "any liquidation service", severe: true }),
    ],
    manual: [
      new CheckZeroDiscovery({ severe: false }),
      new CheckCoverage({
        title: "manual liquidation",
        severe: false,
        useWhitelist: false,
      }),
    ],
  };

  /**
   * Runs checks that do not depend on track roles, should be called once per execution
   */
  public async checkExecution(
    report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification[]> {
    return this.#run(this.#executionChecks, report, curator);
  }

  /**
   * Runs checks for tracks of one role
   * @param report report filtered by role
   */
  public async checkRole(
    report: ExecutionReport,
    role: TrackRole,
    curator?: CuratorName,
  ): Promise<INotification[]> {
    return this.#run(this.#roleChecks[role], report, curator);
  }

  async #run(
    checks: ICheck[],
    report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification[]> {
    const results: INotification[] = [];

    for (const check of checks) {
      this.logger.info(`Running ${check.name}`);
      try {
        const fail = await check.check(report, curator);
        if (fail) {
          this.logger.info(`${check.name} failed`);
          results.push(fail);
        } else {
          this.logger.info(`${check.name} passed`);
        }
      } catch (e) {
        this.logger.error(`${check.name} throwed: ${e}`);
      }
    }
    return results;
  }
}
