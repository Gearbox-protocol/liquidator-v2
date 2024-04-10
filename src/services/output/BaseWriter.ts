import { Inject, Service } from "typedi";

import { CONFIG, ConfigSchema } from "../../config";

@Service()
export default class BaseWriter {
  @Inject(CONFIG)
  config: ConfigSchema;

  protected getFilename(prefix: number | string): string {
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
