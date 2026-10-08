import { Command, Option } from "@commander-js/extra-typings";
import * as z4 from "zod/v4/core";
import { zommandRegistry } from "../zommandRegistry.js";
import { decompressObject } from "./compressedConfig.js";
import type { TemplateData } from "./resolveYamlFiles.js";
import { resolveYamlFiles } from "./resolveYamlFiles.js";

export interface ZommandOptions<T extends z4.$ZodTypes> {
  schema: T;
  templateData?: TemplateData;
  /**
   * If value is string, it's used as default value for config file
   */
  configFile?: boolean | string;
  /**
   * If true, allows to pass config zlib compressed config as --inline-config=... or INLINE_CONFIG env var
   */
  inlineConfig?: boolean;
}

export class Zommand<
  T extends z4.$ZodTypes,
  Args extends any[] = [],
> extends Command<Args, z4.output<T>> {
  #schema: T;
  #templatedData?: TemplateData;
  #envToObjectKeys: Record<string, string> = {};

  constructor(name: string, opts: ZommandOptions<T>) {
    super(name);
    const {
      schema,
      templateData,
      configFile = true,
      inlineConfig = true,
    } = opts;
    this.#schema = schema;
    this.#templatedData = templateData;
    const def = this.#schema._zod.def;

    if (def.type === "object") {
      this.#addOptionsFromObject(def);
    } else if (def.type === "union") {
      for (const o of def.options) {
        const opt = o as z4.$ZodTypes;
        if (opt._zod.def.type === "object") {
          this.#addOptionsFromObject(opt._zod.def);
        }
      }
    } else {
      throw new Error(
        `expected object schema, got ${this.#schema._zod.def.type}`,
      );
    }

    if (configFile) {
      let opt = new Option("--config [file]", "config file (or s3 link");
      if (typeof configFile === "string") {
        opt = opt.default(configFile);
      }
      this.addOption(opt);
    }

    if (inlineConfig) {
      this.addOption(new Option("--inline-config [config]", "inline config"));
    }
  }

  #addOptionsFromObject(def: z4.$ZodObjectDef): void {
    const shape = def.shape;
    for (const [key, optionSchema] of Object.entries(shape)) {
      const meta = zommandRegistry.get(optionSchema);
      if (!meta) {
        continue;
      }
      // this avoids duplicate options in case of discriminated unions
      const existing = this.options.find(o => o.flags === meta.flags);
      if (!existing) {
        let description = meta.description;
        if (meta.env) {
          description = `${description} (env variable ${meta.env})`;
        }
        this.addOption(new Option(meta.flags, description));
        if (meta.env) {
          this.#envToObjectKeys[meta.env] = key;
        }
      }
    }
  }

  override action(
    fn: (
      this: this,
      ...args: [...Args, z4.output<T>, this]
    ) => void | Promise<void>,
  ): this {
    return super.action(async (...args: [...Args, any, this]) => {
      const argz = args;
      const _cmd = argz.splice(-1);
      const [{ config, inlineConfig, ...opts }] = argz.splice(-1);

      let fromYaml: object = {};
      if (config) {
        fromYaml = await resolveYamlFiles(config, {
          ...(process.env as Record<string, string>),
          ...this.#templatedData,
        });
      }
      let fromInlineConfig: object = {};
      if (inlineConfig) {
        fromInlineConfig = await decompressObject(
          inlineConfig,
          this.#templatedData,
        );
      } else if (process.env.INLINE_CONFIG) {
        fromInlineConfig = await decompressObject(
          process.env.INLINE_CONFIG,
          this.#templatedData,
        );
      }

      const schemaFromEnv: Record<string, string> = {};
      for (const [env, key] of Object.entries(this.#envToObjectKeys)) {
        if (process.env[env]) {
          schemaFromEnv[key] = process.env[env]!;
        }
      }

      // deep merge is not required: env and cli flags are for top-level only
      const combined = {
        ...schemaFromEnv,
        ...fromYaml,
        ...fromInlineConfig,
        ...opts,
      };

      const data = z4.parse(this.#schema, combined);
      await fn.apply(this, [...argz, data, this]);
    });
  }
}
