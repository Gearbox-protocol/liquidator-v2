import type { ExecutionReport } from "@gearbox-protocol/liquidator-v2-config";
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

  #checks: ICheck[] = [
    new CheckZeroDiscovery(),
    new CheckCoverage(),
    // new CheckParity(), // TODO: this is unusable for now
    new CheckPermissions(),
    new CheckLiquidationDiscount(),
  ];

  async check(
    report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification[]> {
    const results: INotification[] = [];

    for (const check of this.#checks) {
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
