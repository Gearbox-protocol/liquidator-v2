import events from "node:events";
import { createWriteStream } from "node:fs";
import path from "node:path";
import type { CommonSchema } from "@gearbox-protocol/liquidator-v2-config";
import { json_stringify, SimulationError } from "@gearbox-protocol/sdk/onchain";
import { spawn } from "@homebridge/node-pty-prebuilt-multiarch";
import { nanoid } from "nanoid";
import {
  BaseError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeFunctionData,
} from "viem";
import { DI } from "../di.js";
import { type ILogger, Logger } from "../log/index.js";
import { PreDecodedError } from "./PreDecodedError.js";
import { TransactionRevertedError } from "./TransactionRevertedError.js";

export interface ExplainedError {
  errorJson?: string;
  shortMessage: string;
  longMessage: string;
  traceFile?: string;
}

@DI.Injectable(DI.ErrorHandler)
export class ErrorHandler {
  @DI.Inject(DI.Config)
  config!: CommonSchema;

  @Logger("ErrorHandler")
  log!: ILogger;

  public async explain(
    error: unknown,
    saveTrace?: boolean,
  ): Promise<ExplainedError> {
    try {
      return await this.#explain(error, saveTrace);
    } catch (e) {
      return {
        shortMessage: e instanceof Error ? e.message : String(e),
        longMessage: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async #explain(error: unknown, saveTrace?: boolean): Promise<ExplainedError> {
    if (error instanceof PreDecodedError) {
      return error.decoded;
    }
    if (error instanceof BaseError) {
      let traceFile: string | undefined;
      if (saveTrace) {
        try {
          traceFile = await this.#saveErrorTrace(error);
        } catch {}
      }
      const shortMessages: string[] = [];
      error.walk(e => {
        if (e instanceof BaseError) {
          shortMessages.push(e.shortMessage);
        } else if (e instanceof Error) {
          shortMessages.push(e.message);
        }
        return false;
      });
      const revertData = formatRevertData(error);

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
  async #saveErrorTrace(e: BaseError): Promise<string | undefined> {
    let cast: string[] = [];
    // this only works for anvil, so we expect jsonRpcProviders to be set
    const anvilURL = this.config.jsonRpcProviders?.[0];
    if (!anvilURL) {
      return undefined;
    }
    if (e instanceof TransactionRevertedError) {
      cast = ["run", "--rpc-url", anvilURL.value, e.receipt.transactionHash];
    } else {
      const simErr = e.walk(err => err instanceof SimulationError);
      if (simErr instanceof SimulationError) {
        // replays the original calldata, which is more accurate than re-encoding
        // decoded args, and also works when the abi did not cover the function
        cast = simErr.getCastTraceArgs(anvilURL.value);
        this.log.debug(`calling cast ${cast.slice(0, -1).join(" ")} <data>`);
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
          this.log.debug(`calling cast ${cast.join(" ")} <data>`);
          cast.push(data);
        }
      }
    }
    if (!cast.length) {
      return undefined;
    }
    return this.#runCast(cast);
  }

  /**
   * Runs cast cli command and saves output to a unique file
   * @param args
   * @returns
   */
  async #runCast(args: string[]): Promise<string | undefined> {
    if (!this.config.castBin || !this.config.outDir) {
      return undefined;
    }

    try {
      const traceId = `${nanoid()}.trace`;
      const traceFile = path.resolve(this.config.outDir, traceId);
      const out = createWriteStream(traceFile, "utf-8");
      await events.once(out, "open");
      const castTimeout = this.config.castTimeout;
      const useTimeout = !!castTimeout && !castTimeout.startsWith("0");
      const cmd = useTimeout ? "timeout" : this.config.castBin;
      const fullArgs = useTimeout
        ? [castTimeout, this.config.castBin, ...args]
        : args;
      const command = [cmd, ...fullArgs].map(shellQuote).join(" ");
      out.write(`${command}\n`);
      // use node-pty instead of node:child_process to have colored output
      const pty = spawn(cmd, fullArgs, { cols: 1024 });
      pty.onData(data => out.write(data));
      const exitCode = await new Promise<number>(resolve => {
        pty.onExit(({ exitCode: code }) => resolve(code));
      });
      // `timeout` exits with 124 when the deadline is reached
      if (useTimeout && exitCode === 124) {
        this.log.warn(`cast timed out after ${castTimeout}: ${command}`);
      }
      this.log.debug(`saved trace file: ${traceFile}`);
      return traceId;
    } catch (e) {
      this.log.warn(`failed to save trace: ${e}`);
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
}

/**
 * Prefer the decoded custom error from {@link ContractFunctionRevertedError}.
 * `error.walk()` without a predicate returns the deepest RPC cause, whose
 * `data` is often the raw revert hex — that hides names already decoded higher
 * in the chain (e.g. SafeTransferFailed).
 */
function formatRevertData(error: BaseError): string {
  const reverted = error.walk(e => e instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    if (reverted.data?.errorName) {
      return ` (revert: ${reverted.data.errorName})`;
    }
    if (reverted.raw) {
      return ` (revert: ${reverted.raw})`;
    }
  }

  const lowLevelError = error.walk();
  if ("data" in lowLevelError) {
    if (
      lowLevelError.data &&
      typeof lowLevelError.data === "object" &&
      "errorName" in lowLevelError.data
    ) {
      return ` (revert: ${lowLevelError.data.errorName})`;
    }
    return ` (revert: ${json_stringify(lowLevelError.data, 0)})`;
  }
  if ("raw" in lowLevelError) {
    return ` (revert: ${lowLevelError.raw})`;
  }
  return "";
}

function shellQuote(arg: string): string {
  if (arg === "") {
    return "''";
  }
  if (/^[A-Za-z0-9_\-./:=@%+,]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
