import type { Config } from "../../config/index.js";

export default class BaseWriter {
  protected readonly config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  protected getFilename(prefix: number | bigint | string): string {
    return (
      [
        prefix,
        this.config.underlying?.toLowerCase(),
        this.config.outSuffix.replaceAll("-", ""),
      ]
        .filter(i => !!i)
        .join("-") + ".json"
    );
  }
}
