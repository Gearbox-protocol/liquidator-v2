import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import {
  boolLike,
  optionalAddressArrayLike,
} from "../schemas/schema-primitives.js";
import { zommandRegistry } from "../zommandRegistry.js";
import { compressObject } from "./compressedConfig.js";
import { Zommand } from "./Zommand.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("should create simple command", () => {
  const schema = z.object({
    name: z.string().register(zommandRegistry, {
      flags: "--name <value>",
      description: "name of the user",
      env: "USER_NAME",
    }),
    age: z.coerce.number().optional().register(zommandRegistry, {
      flags: "--age <value>",
      description: "age of the user",
      env: "USER_AGE",
    }),
    admin: boolLike().optional().register(zommandRegistry, {
      flags: "--admin",
      description: "is the user an admin",
      env: "USER_ADMIN",
    }),
  });
  const spy = vi.fn();
  const cmd = new Zommand("test", { schema })
    .description("test command")
    .action(spy);

  it("should parse successfully", async () => {
    await cmd.parseAsync(["--name", "John", "--age", "30", "--admin"], {
      from: "user",
    });
    expect(spy).toHaveBeenCalledWith(
      {
        name: "John",
        age: 30,
        admin: true,
      },
      expect.any(Zommand),
    );
  });

  it("should parse only required", async () => {
    await cmd.parseAsync(["--name", "John"], {
      from: "user",
    });
    expect(spy).toHaveBeenCalledWith(
      {
        name: "John",
      },
      expect.any(Zommand),
    );
  });

  it("should fail", async () => {
    const promise = cmd.parseAsync(["--name", "John", "--age", "John"], {
      from: "user",
    });
    await expect(promise).rejects.toThrow();
  });
});

describe("should parse addresses arrays", () => {
  const schema = z.object({
    marketConfigurators: optionalAddressArrayLike().register(zommandRegistry, {
      flags: "--market-configurators <value>",
      env: "MARKET_CONFIGURATORS",
    }),
  });

  const spy = vi.fn();
  const cmd = new Zommand("test", { schema }).action(spy);
  const mcYaml = path.resolve(__dirname, "./test/market-configurators.yaml");

  it("should parse empty", async () => {
    await cmd.parseAsync([], { from: "user" });
    expect(spy).toHaveBeenCalledWith({}, expect.any(Zommand));
  });

  it("should parse from env", async () => {
    vi.stubEnv(
      "MARKET_CONFIGURATORS",
      "0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002",
    );
    await cmd.parseAsync([], { from: "user" });
    expect(spy).toHaveBeenCalledWith(
      {
        marketConfigurators: [
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000002",
        ],
      },
      expect.any(Zommand),
    );
  });

  it("should parse empty env", async () => {
    vi.stubEnv("MARKET_CONFIGURATORS", "");
    await cmd.parseAsync([], { from: "user" });
    expect(spy).toHaveBeenCalledWith({}, expect.any(Zommand));
  });

  it("should parse from cli", async () => {
    await cmd.parseAsync(
      [
        "--market-configurators",
        "0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002",
      ],
      {
        from: "user",
      },
    );
    expect(spy).toHaveBeenCalledWith(
      {
        marketConfigurators: [
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000002",
        ],
      },
      expect.any(Zommand),
    );
  });

  it("should parse combined env and yaml", async () => {
    vi.stubEnv(
      "MARKET_CONFIGURATORS",
      "0x0000000000000000000000000000000000000003,0x0000000000000000000000000000000000000004",
    );
    const spy = vi.fn();
    const cmd = new Zommand("test", {
      schema,
      configFile: true,
    }).action(spy);
    await cmd.parseAsync(["--config", mcYaml], { from: "user" });
    expect(spy).toHaveBeenCalledWith(
      {
        marketConfigurators: [
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000002",
        ],
      },
      expect.any(Zommand),
    );
  });

  it("should parse combined cli and yaml", async () => {
    const spy = vi.fn();
    const cmd = new Zommand("test", {
      schema,
      configFile: true,
    }).action(spy);
    await cmd.parseAsync(
      [
        "--config",
        mcYaml,
        "--market-configurators",
        "0x0000000000000000000000000000000000000003,0x0000000000000000000000000000000000000004",
      ],
      { from: "user" },
    );
    expect(spy).toHaveBeenCalledWith(
      {
        marketConfigurators: [
          "0x0000000000000000000000000000000000000003",
          "0x0000000000000000000000000000000000000004",
        ],
      },
      expect.any(Zommand),
    );
  });

  it("should parse variadic cli and yaml", async () => {
    const schema = z.object({
      marketConfigurators: optionalAddressArrayLike().register(
        zommandRegistry,
        {
          flags: "--market-configurators <address...>",
          env: "MARKET_CONFIGURATORS",
        },
      ),
    });
    const spy = vi.fn();
    const cmd = new Zommand("test", {
      schema,
      configFile: true,
    }).action(spy);
    await cmd.parseAsync(
      [
        "--config",
        mcYaml,
        "--market-configurators",
        "0x0000000000000000000000000000000000000003",
        "--market-configurators",
        "0x0000000000000000000000000000000000000004",
      ],
      { from: "user" },
    );
    expect(spy).toHaveBeenCalledWith(
      {
        marketConfigurators: [
          "0x0000000000000000000000000000000000000003",
          "0x0000000000000000000000000000000000000004",
        ],
      },
      expect.any(Zommand),
    );
  });

  it("should parse variadic cli and env", async () => {
    vi.stubEnv(
      "MARKET_CONFIGURATORS",
      "0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002",
    );
    const schema = z.object({
      marketConfigurators: optionalAddressArrayLike().register(
        zommandRegistry,
        {
          flags: "--market-configurators <address...>",
          env: "MARKET_CONFIGURATORS",
        },
      ),
    });
    const spy = vi.fn();
    const cmd = new Zommand("test", {
      schema,
      configFile: true,
    }).action(spy);
    await cmd.parseAsync(
      [
        "--market-configurators",
        "0x0000000000000000000000000000000000000003",
        "--market-configurators",
        "0x0000000000000000000000000000000000000004",
      ],
      { from: "user" },
    );
    expect(spy).toHaveBeenCalledWith(
      {
        marketConfigurators: [
          "0x0000000000000000000000000000000000000003",
          "0x0000000000000000000000000000000000000004",
        ],
      },
      expect.any(Zommand),
    );
  });

  it("should parse variadic empty cli and env", async () => {
    vi.stubEnv(
      "MARKET_CONFIGURATORS",
      "0x0000000000000000000000000000000000000001,0x0000000000000000000000000000000000000002",
    );
    const schema = z.object({
      marketConfigurators: optionalAddressArrayLike().register(
        zommandRegistry,
        {
          flags: "--market-configurators <address...>",
          env: "MARKET_CONFIGURATORS",
        },
      ),
    });
    const spy = vi.fn();
    const cmd = new Zommand("test", {
      schema,
      configFile: true,
    }).action(spy);
    await cmd.parseAsync([], { from: "user" });
    expect(spy).toHaveBeenCalledWith(
      {
        marketConfigurators: [
          "0x0000000000000000000000000000000000000001",
          "0x0000000000000000000000000000000000000002",
        ],
      },
      expect.any(Zommand),
    );
  });
});

describe("should handle schemas with defaults", () => {
  const schema = z.object({
    name: z.string().default("John").register(zommandRegistry, {
      flags: "--name <value>",
      description: "name of the user",
      env: "NAME",
    }),
  });
  const spy = vi.fn();
  const cmd = new Zommand("test", { schema }).action(spy);

  it("should use default when explicits provided", async () => {
    await cmd.parseAsync([], { from: "user" });
    expect(spy).toHaveBeenCalledWith({ name: "John" }, expect.any(Zommand));
  });

  it("should prioritize env over default", async () => {
    vi.stubEnv("NAME", "Vasya");
    await cmd.parseAsync([], { from: "user" });
    expect(spy).toHaveBeenCalledWith({ name: "Vasya" }, expect.any(Zommand));
  });

  it("should prioritize cli over env", async () => {
    await cmd.parseAsync(["--name", "Vasya"], { from: "user" });
    expect(spy).toHaveBeenCalledWith({ name: "Vasya" }, expect.any(Zommand));
  });
});

describe("should support discriminated union schemas", () => {
  const fooSchema = z.object({
    mode: z.literal("foo").register(zommandRegistry, {
      flags: "--mode <value>",
      env: "MODE",
    }),
    foo: z.string().register(zommandRegistry, {
      flags: "--foo <value>",
      env: "FOO_VALUE",
    }),
  });
  const barSchema = z.object({
    mode: z.literal("bar").register(zommandRegistry, {
      flags: "--mode <value>",
      env: "MODE",
    }),
    bar: z.string().register(zommandRegistry, {
      flags: "--bar <value>",
      env: "BAR_VALUE",
    }),
  });
  const schema = z.discriminatedUnion("mode", [fooSchema, barSchema]);
  const spy = vi.fn();

  const cmd = new Zommand("test", { schema })
    .description("test command")
    .action(spy);

  it("should parse successfully", async () => {
    await cmd.parseAsync(["--mode", "foo", "--foo", "FOO", "--bar", "BAR"], {
      from: "user",
    });
    expect(spy).toHaveBeenCalledWith(
      {
        mode: "foo",
        foo: "FOO",
      },
      expect.any(Zommand),
    );
  });

  it("should prioritize cli over env", async () => {
    vi.stubEnv("MODE", "bar");
    vi.stubEnv("FOO_VALUE", "xxx");
    vi.stubEnv("BAR_VALUE", "yyy");
    await cmd.parseAsync(["--mode", "foo"], { from: "user" });
    expect(spy).toHaveBeenCalledWith(
      { mode: "foo", foo: "xxx" },
      expect.any(Zommand),
    );
  });
});

describe("should load inline config", () => {
  const schema = z.object({
    name: z.string().register(zommandRegistry, {
      flags: "--name <value>",
      description: "name of the user",
      env: "USER_NAME",
    }),
    age: z.coerce.number().register(zommandRegistry, {
      flags: "--age <value>",
      description: "age of the user",
      env: "USER_AGE",
    }),
    admin: boolLike().optional().register(zommandRegistry, {
      flags: "--admin",
      description: "is the user an admin",
      env: "USER_ADMIN",
    }),
  });

  it("should load inline config from cli flag", async () => {
    const spy = vi.fn();
    const cmd = new Zommand("test", { schema }).action(spy);

    const inlineConfig = compressObject({
      name: "Alice",
      age: 25,
      admin: true,
    });

    await cmd.parseAsync(["--inline-config", inlineConfig], {
      from: "user",
    });
    expect(spy).toHaveBeenCalledWith(
      {
        name: "Alice",
        age: 25,
        admin: true,
      },
      expect.any(Zommand),
    );
  });

  it("should load inline config from INLINE_CONFIG env variable", async () => {
    const spy = vi.fn();
    const cmd = new Zommand("test", { schema }).action(spy);

    const inlineConfig = compressObject({
      name: "Bob",
      age: 30,
      admin: false,
    });

    vi.stubEnv("INLINE_CONFIG", inlineConfig);
    await cmd.parseAsync([], { from: "user" });
    expect(spy).toHaveBeenCalledWith(
      {
        name: "Bob",
        age: 30,
        admin: false,
      },
      expect.any(Zommand),
    );
  });
});
