import type {
  IDedupableNotification,
  INotification,
} from "@gearbox-protocol/cli-utils";
import type { NetworkType } from "@gearbox-protocol/sdk";
import { type Markdown, md } from "@vlad-yakovlev/telegram-md";
import type { Address } from "viem";
import type { Config } from "../../config/index.js";
import { DI } from "../../di.js";
import version from "../../version.js";

export class ServiceStartedNotification implements INotification {
  readonly #name: string;
  readonly #hfThreshold: bigint;
  readonly #restakingWA: boolean;
  readonly #network: NetworkType;

  constructor() {
    const cfg = DI.get(DI.Config) as Config;
    this.#name = cfg.appName;
    this.#hfThreshold = cfg.hfThreshold;
    this.#restakingWA = !!cfg.restakingWorkaround;
    this.#network = cfg.network;
  }

  public messageFor(
    recipient?: Address,
  ): string | IDedupableNotification | undefined {
    if (recipient) {
      return undefined;
    }

    return {
      plain: this.#plain,
      md: this.#markdown,
      dedupeKey: "started",
    };
  }

  get #plain(): string {
    return `[${this.#network}] started ${this.#name} ${version}
HF threshold: ${this.#hfThreshold}
Restaking workaround: ${this.#restakingWA}
`;
  }

  get #markdown(): Markdown {
    return md`[${this.#network}] started ${this.#name} 
Version: ${md.bold(version)}
HF threshold: ${md.bold(this.#hfThreshold.toString(10))}
Restaking workaround: ${md.bold(this.#restakingWA.toString())}
`;
  }
}
