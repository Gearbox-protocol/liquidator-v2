import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it, vi } from "vitest";
import YAML from "yaml";

import {
  getRelativePath,
  resolveFromObject,
  resolveYamlFiles,
} from "./resolveYamlFiles.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const promised = <T>(v: T): Promise<T> => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(v);
    }, 0);
  });
};

afterEach(() => {
  vi.unstubAllEnvs();
});

it("should resolve simple yaml configs", async () => {
  const cfg = await resolveYamlFiles(
    path.resolve(__dirname, "./test/test.yaml"),
    { TEXT: "world", THING: "thing" },
  );
  const expected = await readFile(
    path.resolve(__dirname, "./test/test.expected.yaml"),
    "utf-8",
  );
  expect(cfg).toEqual(YAML.parse(expected));
});

it("should resolve yaml configs with aliases", async () => {
  const cfg = await resolveYamlFiles(
    path.resolve(__dirname, "./test/alias.yaml"),
  );
  const expected = await readFile(
    path.resolve(__dirname, "./test/alias.expected.yaml"),
    "utf-8",
  );
  expect(cfg).toEqual(YAML.parse(expected));
});

it("should resolve yaml configs with promises", async () => {
  vi.stubEnv("RPC_URL", "http://rpc.com");
  const sm = {
    RPC_URL1: promised("http://one.com"),
    RPC_URL2: promised("http://two.com"),
    SOME: {
      DEEP: {
        KEY: promised("deeper"),
      },
    },
  };
  const cfg = await resolveYamlFiles(
    path.resolve(__dirname, "./test/promise.yaml"),
    {
      ...process.env,
      sm,
    },
  );
  const expected = await readFile(
    path.resolve(__dirname, "./test/promise.expected.yaml"),
    "utf-8",
  );
  expect(cfg).toEqual(YAML.parse(expected));
});

it("should build s3 url from relative path", () => {
  expect(
    getRelativePath("s3://bucket/path/to/base.yaml", "./relative.yaml"),
  ).toEqual("s3://bucket/path/to/relative.yaml");
  expect(
    getRelativePath("s3://bucket/path/to/base.yaml", "../other/file.yaml"),
  ).toEqual("s3://bucket/path/other/file.yaml");
});

it("should support default values via ${KEY:-default} syntax", async () => {
  const json = {
    set: "${SET:-fallback}",
    missing: "${MISSING:-fallback}",
    empty: "${EMPTY:-fallback}",
    deepMissing: "${sm.MISSING:-deep-default}",
    noDefault: "${UNRESOLVED}",
    interpolated: "prefix-${MISSING:-mid}-suffix",
  };

  const templateData = {
    SET: "bar",
    EMPTY: "",
    sm: {},
  };

  const result = await resolveFromObject(json, templateData);

  expect(result).toEqual({
    set: "bar",
    missing: "fallback",
    empty: "fallback",
    deepMissing: "deep-default",
    noDefault: "${UNRESOLVED}",
    interpolated: "prefix-mid-suffix",
  });
});

it("should resolve deep promised value in resolveFromObject", async () => {
  const json = {
    config: {
      nested: {
        value: "${sm.SOME.DEEP.KEY}",
      },
    },
  };

  const templateData = {
    sm: {
      SOME: {
        DEEP: {
          KEY: promised("deep-resolved-value"),
        },
      },
    },
  };

  const result = await resolveFromObject(json, templateData);

  expect(result).toEqual({
    config: {
      nested: {
        value: "deep-resolved-value",
      },
    },
  });
});
