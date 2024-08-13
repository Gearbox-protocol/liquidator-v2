import events from "node:events";
import { createWriteStream, writeFileSync } from "node:fs";
import path from "node:path";

import { nanoid } from "nanoid";
import { spawn } from "node-pty";
import {
  BaseError,
  ContractFunctionExecutionError,
  encodeFunctionData,
} from "viem";

import type { Config } from "../config/index.js";
import type { CreditAccountData } from "../data/index.js";
import type { ILogger } from "../log/index.js";
import { json_stringify } from "../utils/index.js";
import { TransactionRevertedError } from "./TransactionRevertedError.js";

export interface ExplainedError {
  errorJson?: string;
  shortMessage: string;
  longMessage: string;
  traceFile?: string;
}

export class ErrorHandler {
  log: ILogger;
  config: Config;

  constructor(config: Config, log: ILogger) {
    this.config = config;
    this.log = log;
  }

  public async explain(
    error: unknown,
    context?: CreditAccountData,
    saveTrace?: boolean,
  ): Promise<ExplainedError> {
    const logger = this.#caLogger(context);

    if (error instanceof BaseError) {
      const errorJson = `${nanoid()}.json`;
      const errorFile = path.resolve(this.config.outDir, errorJson);
      const asStr = json_stringify(error);
      writeFileSync(errorFile, asStr, "utf-8");
      logger.debug(`saved original error to ${errorFile}`);

      let traceFile: string | undefined;
      if (saveTrace) {
        traceFile = await this.#saveErrorTrace(error, context);
      }

      return {
        errorJson,
        traceFile,
        shortMessage: error.shortMessage,
        longMessage: error.message,
      };
    }
    const longMessage = error instanceof Error ? error.message : `${error}`;
    const shortMessage = longMessage.split("\n")[0].slice(0, 128);
    return {
      longMessage,
      shortMessage,
    };
  }

  public async saveTransactionTrace(hash: string): Promise<string | undefined> {
    return this.#runCast([
      "run",
      "--rpc-url",
      this.config.ethProviderRpcs[0],
      hash,
    ]);
  }

  /**
   * Safely tries to save trace of failed transaction to configured output
   * @param error
   * @returns
   */
  async #saveErrorTrace(
    e: BaseError,
    context?: CreditAccountData,
  ): Promise<string | undefined> {
    let cast: string[] = [];
    if (e instanceof TransactionRevertedError) {
      cast = [
        "run",
        "--rpc-url",
        this.config.ethProviderRpcs[0],
        e.receipt.transactionHash,
      ];
    } else {
      const exErr = e.walk(
        err => err instanceof ContractFunctionExecutionError,
      );
      if (
        exErr instanceof ContractFunctionExecutionError &&
        exErr.contractAddress
      ) {
        const data = encodeFunctionData({
          abi: exErr.abi,
          args: exErr.args,
          functionName: exErr.functionName,
        });
        cast = [
          "call",
          "--trace",
          "--rpc-url",
          this.config.ethProviderRpcs[0],
          exErr.contractAddress,
          data,
        ];
      }
    }
    if (!cast.length) {
      return undefined;
    }
    return this.#runCast(cast, context);
  }

  /**
   * Runs cast cli command and saves output to a unique file
   * @param args
   * @param context
   * @returns
   */
  async #runCast(
    args: string[],
    context?: CreditAccountData,
  ): Promise<string | undefined> {
    if (!this.config.castBin || !this.config.outDir) {
      return undefined;
    }

    const logger = this.#caLogger(context);
    try {
      const traceId = `${nanoid()}.trace`;
      const traceFile = path.resolve(this.config.outDir, traceId);
      const out = createWriteStream(traceFile, "utf-8");
      await events.once(out, "open");
      // use node-pty instead of node:child_process to have colored output
      const pty = spawn(this.config.castBin, args, { cols: 1024 });
      pty.onData(data => out.write(data));
      await new Promise(resolve => {
        pty.onExit(() => resolve(undefined));
      });
      logger.debug(`saved trace file: ${traceFile}`);
      return traceId;
    } catch (e) {
      logger.warn(`failed to save trace: ${e}`);
    }
  }

  #caLogger(ca?: CreditAccountData): ILogger {
    return ca
      ? this.log.child({
          account: ca.addr,
          manager: ca.managerName,
        })
      : this.log;
  }
}
