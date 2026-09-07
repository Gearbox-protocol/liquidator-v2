import type { ExecutionReport } from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import { TypedObjectUtils } from "@gearbox-protocol/sdk/onchain";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import { groupBy, keyBy } from "lodash-es";
import type { Address } from "viem";
import type { Config } from "../config";
import DI from "../di";
import type { INotification } from "../notifier";
import type { TypedSDK } from "../types";
import { mdList } from "../utils";
import { type AccCheckStatus, getFailedAccounts } from "./getFailedAccounts";
import type { ICheck, TrackFilter } from "./types";

interface CMCheck {
  name?: string;
  address: Address;
  accounts: Address[];
}

interface CheckCoverageOptions {
  title?: string;
  filter?: TrackFilter;
  severe?: boolean;
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

  readonly #filter: TrackFilter;
  readonly #title: string;
  readonly #severe: boolean;

  constructor(opts: CheckCoverageOptions = {}) {
    const { title, filter, severe = true } = opts;
    this.#filter = filter ?? (() => true);
    this.#title = title ?? "any liquidator";
    this.#severe = severe;
  }

  async check(
    report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification | undefined> {
    const { tracks, whitelist } = report;
    const tracksById = keyBy(tracks, "id");
    const results = report.results.filter(r =>
      this.#filter(tracksById[r.trackId]),
    );
    const { nonWhitelisted, whitelisted } = getFailedAccounts(
      { results, whitelist },
      curator,
    );

    if (nonWhitelisted.length === 0) {
      return;
    }

    const failedByCm = groupBy(nonWhitelisted, "cm") as Record<
      Address,
      AccCheckStatus[]
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
      numWhitelisted: whitelisted.length,
      title: this.#title,
      severe: this.#severe,
    });
  }
}

interface CheckCoverageFailOptions {
  fails: CMCheck[];
  numWhitelisted: number;
  title: string;
  severe?: boolean;
}

export class CheckCoverageFail implements INotification {
  public readonly severe: boolean;
  public readonly fails: CMCheck[];
  public readonly numWhitelisted: number;
  public readonly title: string;

  constructor(opts: CheckCoverageFailOptions) {
    const { fails, numWhitelisted, title, severe = true } = opts;
    this.fails = fails;
    this.numWhitelisted = numWhitelisted;
    this.severe = severe && fails.length > 0;
    this.title = title;
  }

  public get md(): Markdown {
    const whitelisted = this.numWhitelisted
      ? ` (${this.numWhitelisted} whitelisted)`
      : "";
    const msg = md`Some credit accounts cannot be liquidated by ${this.title}${whitelisted}:`;
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
