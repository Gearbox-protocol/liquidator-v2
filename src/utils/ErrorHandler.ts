import events from "node:events";
import { createWriteStream } from "node:fs";
import path from "node:path";

import { isError } from "ethers";
import { nanoid } from "nanoid";
import { spawn } from "node-pty";
import { Inject, Service } from "typedi";
import { BaseError } from "viem";

import { CONFIG, Config } from "../config/index.js";
import { Logger, LoggerInterface } from "../log/index.js";

export interface ExplainedError {
  original: any;
  shortMessage: string;
  longMessage: string;
  traceFile?: string;
}

@Service()
export class ErrorHandler {
  @Logger("ErrorHandler")
  log: LoggerInterface;

  @Inject(CONFIG)
  config: Config;

  constructor() {
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

  #minify(e: BaseError): BaseError {
    e.message = e.shortMessage;
    if ("abi" in e) {
      e.abi = undefined;
    }
    if (e.cause instanceof BaseError) {
      e.cause = this.#minify(e.cause);
    }
    return e;
  }
}
