import type { ExecutionReport } from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import { TypedObjectUtils } from "@gearbox-protocol/sdk/onchain";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import { groupBy } from "lodash-es";
import type { Address } from "viem";
import type { Config } from "../config";
import DI from "../di";
import type { INotification } from "../notifier";
import type { TypedSDK } from "../types";
import { mdList } from "../utils";
import { type FailedAccount, getFailedAccounts } from "./getFailedAccounts";
import type { ICheck } from "./types";

interface CMCheck {
  name?: string;
  address: Address;
  accounts: Address[];
}

interface CheckCoverageOptions {
  title?: string;
  severe?: boolean;
  /**
   * Whether whitelisted accounts are excluded. The whitelist is always ignored for curators
   */
  useWhitelist?: boolean;
}

/**
 * Checks that every credit account is liquidated by at least one liquidator
 */
export class CheckCoverage implements ICheck {
  @DI.Inject(DI.Config)
  public readonly config!: Config;
  @DI.Inject(DI.SDK)
  public readonly sdk!: TypedSDK;

  public readonly name = "check-coverage";

  readonly #title: string;
  readonly #severe: boolean;
  readonly #useWhitelist: boolean;

  constructor(opts: CheckCoverageOptions = {}) {
    const { title, severe = true, useWhitelist = true } = opts;
    this.#title = title ?? "any liquidator";
    this.#severe = severe;
    this.#useWhitelist = useWhitelist;
  }

  async check(
    report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification | undefined> {
    const failed = getFailedAccounts(report, {
      useWhitelist: this.#useWhitelist && !curator,
    });

    if (failed.length === 0) {
      return;
    }

    const failedByCm = groupBy(failed, "cm") as Record<
      Address,
      FailedAccount[]
    >;
    const cmFails = TypedObjectUtils.entries(failedByCm).map(
      ([address, accs]): CMCheck => {
        return {
          name: this.sdk.marketRegister.findCreditManager(address)?.name,
          address,
          accounts: accs.map(e => e.acc),
        };
      },
    );
    return new CheckCoverageFail({
      fails: cmFails,
      title: this.#title,
      severe: this.#severe,
    });
  }
}

interface CheckCoverageFailOptions {
  fails: CMCheck[];
  title: string;
  severe?: boolean;
}

export class CheckCoverageFail implements INotification {
  public readonly severe: boolean;
  public readonly fails: CMCheck[];
  public readonly title: string;

  constructor(opts: CheckCoverageFailOptions) {
    const { fails, title, severe = true } = opts;
    this.fails = fails;
    this.severe = severe && fails.length > 0;
    this.title = title;
  }

  public get md(): Markdown {
    const msg = md`Some credit accounts cannot be liquidated by ${this.title}:`;
    const cms = this.fails?.length
      ? mdList(
          this.fails.map(({ name, address, accounts }) => {
            const cm = name ? md`${name}` : md.inlineCode(address);
            const accs = md.join(
              accounts.map(a => md.inlineCode(a)),
              ", ",
            );
            return md`in ${cm}: ${accs}`;
          }),
        )
      : undefined;
    return md.join([msg, cms].filter(Boolean), "\n");
  }
}
