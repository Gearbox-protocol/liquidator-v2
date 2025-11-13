import events from "node:events";
import { createWriteStream } from "node:fs";
import path from "node:path";

import { type CreditAccountData, json_stringify } from "@gearbox-protocol/sdk";
import { nanoid } from "nanoid";
import { spawn } from "node-pty";
import {
  BaseError,
  ContractFunctionExecutionError,
  encodeFunctionData,
} from "viem";

import type { CommonSchema } from "../config/index.js";
import type { ILogger } from "../log/index.js";
import { TransactionRevertedError } from "./TransactionRevertedError.js";

export interface ExplainedError {
  errorJson?: string;
  shortMessage: string;
  longMessage: string;
  traceFile?: string;
}

export class ErrorHandler {
  log: ILogger;
  config: CommonSchema;

  constructor(config: CommonSchema, log: ILogger) {
    this.config = config;
    this.log = log;
  }

  public async explain(
    error: unknown,
    context?: CreditAccountData,
    saveTrace?: boolean,
  ): Promise<ExplainedError> {
    if (error instanceof BaseError) {
      let traceFile: string | undefined;
      if (saveTrace) {
        try {
          traceFile = await this.#saveErrorTrace(error, context);
        } catch {}
      }
      const shortMessages: string[] = [];
      const lowLevelError = error.walk();
      error.walk(e => {
        if (e instanceof BaseError) {
          shortMessages.push(e.shortMessage);
        } else if (e instanceof Error) {
          shortMessages.push(e.message);
        }
        return false;
      });
      let revertData = "";
      if ("data" in lowLevelError) {
        if (
          lowLevelError.data &&
          typeof lowLevelError.data === "object" &&
          "errorName" in lowLevelError.data
        ) {
          revertData = ` (revert: ${lowLevelError.data.errorName})`;
        } else {
          revertData = ` (revert: ${json_stringify(lowLevelError.data, 0)})`;
        }
      } else if ("raw" in lowLevelError) {
        revertData = ` (revert: ${lowLevelError.raw})`;
      }

      return {
        // errorJson,
        traceFile,
        shortMessage: `${error.name}${revertData}: ${shortMessages.join(": ")}`,
        longMessage: `${error.name}${revertData}: ${error.message}`,
      };
    }
    if (error instanceof Error) {
      return this.#unwrapCause(error);
    }
    const longMessage = `${error}`;
    const shortMessage = longMessage.split("\n")[0].slice(0, 128);
    return {
      longMessage,
      shortMessage,
    };
  }

  public async saveTransactionTrace(hash: string): Promise<string | undefined> {
    // this only works for anvil, so we expect jsonRpcProviders to be set
    const anvilURL = this.config.jsonRpcProviders?.[0];
    if (!anvilURL) {
      return undefined;
    }

    return this.#runCast(["run", "--rpc-url", anvilURL.value, hash]);
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
    // this only works for anvil, so we expect jsonRpcProviders to be set
    const anvilURL = this.config.jsonRpcProviders?.[0];
    if (!anvilURL) {
      return undefined;
    }
    if (e instanceof TransactionRevertedError) {
      cast = ["run", "--rpc-url", anvilURL.value, e.receipt.transactionHash];
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
          anvilURL.value,
          ...(exErr.sender ? ["--from", exErr.sender] : []),
          exErr.contractAddress,
          // data,
        ];
        this.#caLogger(context).debug(`calling cast ${cast.join(" ")} <data>`);
        cast.push(data);
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

  #unwrapCause(e: Error): Pick<ExplainedError, "longMessage" | "shortMessage"> {
    const shortMessage = e.message.split("\n")[0].slice(0, 128);
    let longMessage = e.message;
    if (e.cause) {
      const cause = this.#unwrapCause(e.cause as Error);
      longMessage = `${longMessage}Cause: ${cause.longMessage}`;
    }
    return { shortMessage, longMessage };
  }

  #caLogger(ca?: CreditAccountData): ILogger {
    return ca
      ? this.log.child({
          account: ca.creditAccount,
          manager: ca.creditManager, // TODO: credit manager name
        })
      : this.log;
  }
}
