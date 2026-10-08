import { deflateSync, inflateSync } from "node:zlib";
import { resolveFromObject } from "./resolveYamlFiles.js";

/**
 * Compress a plain JS object into a base64url string
 * suitable for env vars.
 */
export function compressObject(obj: unknown): string {
  const json = JSON.stringify(obj);
  const compressed = deflateSync(Buffer.from(json, "utf8"));
  return compressed.toString("base64url");
}

/**
 * Decompress a base64url string back into a JS object
 * Allows to pass template data to resolve promises/env
 */
export async function decompressObject<T = unknown>(
  value: string,
  templateData?: Record<string, unknown>,
): Promise<T> {
  const compressed = Buffer.from(value, "base64url");
  const str = inflateSync(compressed).toString("utf8");
  const json = JSON.parse(str);
  const result = await resolveFromObject(json, templateData);
  return result as T;
}
