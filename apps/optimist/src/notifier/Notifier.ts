import type {
  ExecutionReport,
  OptimisticResult,
  TrackReport,
} from "@gearbox-protocol/liquidator-v2-config";
import type { CuratorName } from "@gearbox-protocol/sdk/model";
import {
  AddressMap,
  findCuratorMarketConfigurator,
  hexEq,
} from "@gearbox-protocol/sdk/onchain";
import { Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Logger as ILogger } from "pino";
import type { Address } from "viem";
import type { Config, NotificationsConfig } from "../config";
import DI from "../di";
import { Logger } from "../logger";
import type { TypedSDK } from "../types";
import { formatDuration, marketsForCurator, mdList } from "../utils";
import TelegramNotifier from "./TelegramNotifier";
import type { INotification, INotifier } from "./types";

export class Notifier {
  @DI.Inject(DI.Config)
  public readonly config!: Config;

  @DI.Inject(DI.SDK)
  public readonly sdk!: TypedSDK;

  @Logger("Notifier")
  public readonly logger!: ILogger;

  #notifiers: INotifier[];
  #curator?: CuratorName;

  constructor(options: NotificationsConfig) {
    const notifiers: INotifier[] = [];
    switch (options.type) {
      case "telegram":
        notifiers.push(new TelegramNotifier(options));
        break;
    }
    this.#notifiers = notifiers;
    this.#curator = options.curator as CuratorName;
  }

  public async notify(
    result: ExecutionReport,
    failedChecks: INotification[],
  ): Promise<void> {
    try {
      this.logger.debug("notifying");
      let msgs = this.#generateMessages(result, failedChecks);
      if (this.#curator) {
        // only send severe messages for curators
        msgs = msgs.filter(m => m.severe);
      }
      if (msgs.length > 0) {
        await Promise.all(this.#notifiers.map(n => n.notify(msgs)));
      }
    } catch (e) {
      this.logger.error(e);
    }
  }

  #generateMessages(
    result: ExecutionReport,
    failedChecks: INotification[],
  ): INotification[] {
    const severe = failedChecks.some(e => e.severe);
    const success = failedChecks.length === 0;
    let title = "optimistic execution finished successfully";
    if (!success) {
      if (severe) {
        title = "optimistic execution finished with severe warnings";
      } else {
        title = "optimistic execution finished with some warnings";
      }
    }
    const emoji = success
      ? "✅"
      : failedChecks.some(c => c.severe)
        ? "❌"
        : "⚠️";

    const header = this.#generateHeader(emoji, title);
    const warnings = failedChecks.map(w =>
      w.severe ? md`❌ ${w.md}` : md`⚠️ ${w.md}`,
    );
    const stats = this.#generateStats(result);
    const footer = this.#generateFooter(this.sdk.currentBlock, undefined);

    const messages = this.#splitMessage(
      header,
      [...stats, ...warnings],
      footer,
    );

    return messages.map(m => ({ severe, md: m }));
  }

  #splitMessage(
    header: Markdown,
    content: Markdown[],
    footer: Markdown,
  ): Markdown[] {
    const message = md.join([header, ...content, footer], "\n\n");
    const len = message.toString().length;

    if (len > 4096) {
      if (content.length > 1) {
        const [first, ...rest] = content;
        return [
          ...this.#splitMessage(header, [first], footer),
          ...this.#splitMessage(header, rest, footer),
        ];
      } else {
        // shorten content
        let rawContent = content[0].toString().slice(0, 4096 - len);
        // TODO: it can end in between bold text...
        if (rawContent.endsWith("\\") && !rawContent.endsWith("\\\\")) {
          rawContent = rawContent.slice(0, -1);
        }
        return [
          md.join([header, new Markdown(rawContent, true), footer], "\n\n"),
        ];
      }
    }

    return [message];
  }

  #generateStats(report: ExecutionReport): Markdown[] {
    // for curators, we don't want to show the stats
    if (this.#curator) {
      return [];
    }

    const grouped = new AddressMap<OptimisticResult[]>();
    const markets = marketsForCurator(this.sdk, this.#curator);
    const managers =
      markets?.flatMap(m => m.creditManagers) ??
      this.sdk.marketRegister.creditManagers;
    for (const cm of managers) {
      grouped.upsert(cm.creditManager.address, []);
    }
    for (const r of report.results) {
      const current = grouped.get(r.creditManager) ?? [];
      grouped.upsert(r.creditManager, [...current, r]);
    }

    const groupedEntries = grouped.entries().sort((a, b) => {
      return b[1].length - a[1].length;
    });
    const lines: Markdown[] = [];
    const emptyCms: Markdown[] = [];
    for (const [addr, results] of groupedEntries) {
      if (results.length === 0) {
        const cm = this.sdk.marketRegister.findCreditManager(addr);
        emptyCms.push(md.bold(cm?.creditManager?.name ?? addr));
      } else {
        lines.push(
          this.#generateLineForCreditManager(addr, report.tracks, results),
        );
      }
    }
    if (emptyCms.length > 0) {
      lines.push(md`${md.join(emptyCms, ", ")}: 0 accounts`);
    }
    return [mdList(lines)];
  }

  #generateLineForCreditManager(
    cmAddr: Address,
    tracks: TrackReport[],
    results: OptimisticResult[],
  ): Markdown {
    let accounts = 0;
    let cmName = md.bold(cmAddr);
    try {
      const cm = this.sdk.marketRegister.findCreditManager(cmAddr);
      accounts = this.sdk.plugins.accounts.accounts.filter(a =>
        hexEq(a.creditManager, cmAddr),
      ).length;
      cmName = md.bold(cm.creditManager.name);
    } catch {}
    if (accounts === 0) {
      return md`${cmName}: 0 accounts`;
    }
    const mdLines = tracks.map(t =>
      this.#generateTrackSummary(
        t,
        results.filter(r => r.trackId === t.id),
        Number(accounts),
      ),
    );
    return md`${cmName} - ${md.join(mdLines, ", ")}`;
  }

  #generateTrackSummary(
    track: TrackReport,
    results: OptimisticResult[],
    totalSDK: number,
  ): Markdown {
    const success = results?.filter(r => !r.isError)?.length ?? 0;
    const total = Math.max(results.length, totalSDK);
    return md`${md.bold(track.name)}: ${success}/${total}`;
  }

  #generateHeader(emoji: string, message: string): Markdown {
    const { extraHeaderTag, network } = this.config;
    const tags = md.join(
      [extraHeaderTag, this.#curator, network.toUpperCase()]
        .filter(Boolean)
        .map(s => `[${s}]`),
      "",
    );
    return md.join([emoji, tags, message], " ");
  }

  #generateFooter(
    blockNumber: bigint,
    duration?: { start: Date; end: Date },
  ): Markdown {
    const { executionId } = this.config;
    let [block, execution, durationS, report]: Array<Markdown | undefined> = [
      md`block: ${md.inlineCode(blockNumber)}`,
    ];

    let link = `https://anvil.gearbox.foundation/optimist/${executionId}`;
    if (this.#curator) {
      const mc = findCuratorMarketConfigurator(
        this.#curator,
        this.config.network,
      );
      if (mc) {
        link = `https://anvil.gearbox.foundation/optimist/${executionId}?marketConfigurator=${mc}`;
      }
    }

    report = md.link("[report]", link);

    if (duration) {
      durationS = md`duration: ${md.bold(formatDuration(duration))}`;
    }
    execution = md`execution id: ${md.inlineCode(executionId)}`;
    return md`\n ${md.join(
      [block, execution, durationS, report].filter(m => !!m?.toString().length),
      ", ",
    )}`;
  }
}
