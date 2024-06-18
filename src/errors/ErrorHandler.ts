import events from "node:events";
import { createWriteStream, writeFileSync } from "node:fs";
import path from "node:path";

import { nanoid } from "nanoid";
import { spawn } from "node-pty";
import { BaseError } from "viem";

import type { Config } from "../config/index.js";
import type { LoggerInterface } from "../log/index.js";
import { json_stringify } from "../utils/index.js";
import { TransactionRevertedError } from "./TransactionRevertedError.js";

export interface ExplainedError {
  errorJson?: string;
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
  }

  public async explain(
    e: unknown,
    saveTrace?: boolean,
  ): Promise<ExplainedError> {
    if (e instanceof BaseError) {
      const errorJson = `${nanoid()}.json`;
      const traceFile = path.resolve(this.config.outDir, errorJson);
      const asStr = json_stringify(e);
      writeFileSync(traceFile, asStr, "utf-8");
      this.log.debug(`saved original error to ${traceFile}`);

      if (e instanceof TransactionRevertedError && saveTrace) {
        await this.#saveErrorTrace(e);
      }

      return {
        errorJson,
        shortMessage: e.shortMessage,
        longMessage: e.message,
      };
    }
    const longMessage = e instanceof Error ? e.message : `${e}`;
    const shortMessage = longMessage.split("\n")[0].slice(0, 128);
    return {
      longMessage,
      shortMessage,
    };
  }

  /**
   * Safely tries to save trace of failed transaction to configured output
   * @param error
   * @returns
   */
  async #saveErrorTrace(
    e: TransactionRevertedError,
  ): Promise<string | undefined> {
    if (!this.config.castBin || !this.config.outDir) {
      return undefined;
    }

    try {
      const traceId = `${nanoid()}.trace`;
      const traceFile = path.resolve(this.config.outDir, traceId);
      const out = createWriteStream(traceFile, "utf-8");
      await events.once(out, "open");
      // use node-pty instead of node:child_process to have colored output
      const pty = spawn(
        this.config.castBin,
        // [
        //   "call",
        //   "--trace",
        //   "--rpc-url",
        //   this.config.ethProviderRpcs[0],
        //   e.receipt.to,
        //   e.receipt.data,
        // ],
        [
          "run",
          "--rpc-url",
          this.config.ethProviderRpcs[0],
          e.receipt.transactionHash,
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

  // #tryDecodeAbiError(err: BaseError): Promise<BaseError> {
  //   if (!(err instanceof ContractFunctionExecutionError)) {
  //     return err;
  //   }
  //   const revert = err.walk(e => e instanceof ContractFunctionRevertedError);
  //   if (
  //     revert instanceof ContractFunctionRevertedError &&
  //     revert.cause instanceof AbiErrorSignatureNotFoundError
  //   ) {
  //     err.
  //   }
  // }
}
