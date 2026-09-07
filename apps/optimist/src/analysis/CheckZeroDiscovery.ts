import type {
  ExecutionReport,
  TrackReport,
} from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import type { Markdown } from "@vlad-yakovlev/telegram-md";
import { md } from "@vlad-yakovlev/telegram-md";
import type { Config } from "../config";
import DI from "../di";
import type { INotification } from "../notifier";
import type { TypedSDK } from "../types";
import type { ICheck } from "./types";

/**
 * Checks that all liquidators discover at least one credit account
 */
export class CheckZeroDiscovery implements ICheck {
  public readonly name = "zero-discovery";

  @DI.Inject(DI.SDK)
  public readonly sdk!: TypedSDK;

  @DI.Inject(DI.Config)
  public readonly config!: Config;

  async check(
    report: ExecutionReport,
    curator?: CuratorName,
  ): Promise<INotification | undefined> {
    if (curator) {
      return undefined;
    }

    const disableZeroDiscoveryWarning = new Map(
      Object.entries(this.config.liquidators).map(([id, liq]) => [
        id,
        liq.disableZeroDiscoveryWarning,
      ]),
    );
    const totalAccounts = this.sdk.plugins.accounts.accounts.length;
    const { results, tracks } = report;
    const countByTrackId: Record<string, number> = {};
    for (const result of results) {
      countByTrackId[result.trackId] =
        (countByTrackId[result.trackId] ?? 0) + 1;
    }
    const failedTracks = tracks.filter(
      t => !countByTrackId[t.id] && !disableZeroDiscoveryWarning.get(t.id),
    );
    if (failedTracks.length > 0 && totalAccounts > 0) {
      // Do not notify when all TS tracks were failed together
      // This is likely a temprary fluke and will be gone on next execution
      // Otherwise it should be caught by monitoring lambda
      if (failedTracks.length === tracks.length) {
        return undefined;
      }

      return new ZeroDiscoveryFail(failedTracks);
    }
  }
}

export class ZeroDiscoveryFail implements INotification {
  public readonly severe = true;
  public readonly tracks: TrackReport[];

  constructor(tracks: TrackReport[]) {
    this.tracks = tracks;
  }

  public get md(): Markdown {
    const names = this.tracks.map(t => t.name).join(", ");
    return md`Some liquidators discovered zero accounts: ${names}`;
  }
}
