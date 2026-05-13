import { BaseError } from "viem";
import type { ExplainedError } from "./ErrorHandler.js";

/**
 * Wraps an error whose trace has already been generated against the relevant
 * chain state. Used when a strategy needs to save a foundry trace before
 * rolling back an anvil snapshot, so the caller can reuse the decoded result
 * instead of regenerating it (potentially against post-revert state).
 */
export class PreDecodedError extends BaseError {
  override name = "PreDecodedError";

  public readonly decoded: ExplainedError;
  public readonly original: Error;

  constructor(original: Error, decoded: ExplainedError) {
    super(original.message, { cause: original });
    this.original = original;
    this.decoded = decoded;
  }
}
