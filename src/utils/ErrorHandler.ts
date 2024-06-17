import events from "node:events";
import { createWriteStream } from "node:fs";
import path from "node:path";

import { isError } from "ethers";
import { nanoid } from "nanoid";
import { spawn } from "node-pty";
import { BaseError } from "viem";

import type { Config } from "../config/index.js";
import type { LoggerInterface } from "../log/index.js";
import { json_parse, json_stringify } from "./bigint-serializer.js";

export interface ExplainedError {
  original: any;
  shortMessage: string;
  longMessage: string;
  traceFile?: string;
}

export class ErrorHandler {
  log: LoggerInterface;
  config: Config;

  constructor(config: Config, log: LoggerInterface) {
    this.config = config;
    this.log = log;
    this.#minify.bind(this);
  }

  public async explain(
    e: unknown,
    saveTrace?: boolean,
  ): Promise<ExplainedError> {
    if (e instanceof BaseError) {
      // const revertError = e.walk(
      //   err => err instanceof ContractFunctionRevertedError,
      // );
      // if (revertError instanceof ContractFunctionRevertedError) {
      //   const errorName = revertError.data?.errorName ?? "";
      //   // do something with `errorName`
      // }
      return {
        original: this.#minify(e),
        shortMessage: e.shortMessage,
        longMessage: e.message,
      };
    }
    const longMessage = e instanceof Error ? e.message : `${e}`;
    const shortMessage = longMessage.split("\n")[0].slice(0, 128);
    return {
      original: e,
      longMessage,
      shortMessage,
    };
  }

  /**
   * Safely tries to save trace of failed transaction to configured output
   * @param error
   * @returns
   */
  async #saveErrorTrace(e: any): Promise<string | undefined> {
    if (!this.config.castBin || !this.config.outDir) {
      return undefined;
    }

    if (isError(e, "CALL_EXCEPTION") && e.transaction?.to) {
      try {
        const traceId = `${nanoid()}.trace`;
        const traceFile = path.resolve(this.config.outDir, traceId);
        const out = createWriteStream(traceFile, "utf-8");
        await events.once(out, "open");
        // use node-pty instead of node:child_process to have colored output
        const pty = spawn(
          this.config.castBin,
          [
            "call",
            "--trace",
            "--rpc-url",
            this.config.ethProviderRpcs[0],
            e.transaction.to,
            e.transaction.data,
          ],
          { cols: 1024 },
        );
        pty.onData(data => out.write(data));
        await new Promise(resolve => {
          pty.onExit(() => resolve(undefined));
        });
        this.log.debug(`saved trace file: ${traceFile}`);
        return traceId;
      } catch (e) {
        this.log.warn(`failed to save trace: ${e}`);
      }
    }
  }

  #minify(e: BaseError): any {
    e.message = e.shortMessage;
    if ("abi" in e) {
      e.abi = undefined;
    }
    if (e.cause instanceof BaseError) {
      e.cause = this.#minify(e.cause);
    }
    const asStr = json_stringify(e).replaceAll("\n", "\\n");
    return json_parse(asStr);
  }
}
