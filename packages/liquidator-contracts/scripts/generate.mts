/**
 * Regenerates the committed ABI and bytecode sources for this package.
 *
 * router-v3 keeps only its solidity contracts and the npm packages required to
 * compile them, so all JS codegen tooling lives here. This script clones
 * router-v3, compiles it with foundry, and then runs this package's own
 * `wagmi generate` and bytecode generator against the resulting `forge-out`
 * artifacts.
 *
 * Prerequisites on the host machine: `git`, `yarn` and `foundry` (`forge`).
 *
 * Usage:
 *   pnpm --filter @gearbox-protocol/liquidator-contracts generate -- --branch <branch>
 *   pnpm --filter @gearbox-protocol/liquidator-contracts generate -- --source-dir <path>
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROUTER_V3_REPO = "git@github.com:Gearbox-protocol/router-v3.git";

// Concrete contracts whose deployment bytecode we expose (interfaces excluded).
const BYTECODE_CONTRACTS = [
  "AaveFLTaker",
  "AaveLiquidator",
  "AaveUnwinder",
  "BatchLiquidator",
  "GhoFMTaker",
  "GhoFrxUSDLiquidator",
  "GhoFrxUSDUnwinder",
  "GhoLiquidator",
  "GhoUnwinder",
  "MorphoLiquidator",
  "MorphoUnwinder",
  "SecuritizeLiquidatorHelper",
  "SiloFLTaker",
  "SiloLiquidator",
  "SiloUnwinder",
] as const;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const repoRoot = resolve(packageDir, "..", "..");

function run(
  command: string,
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): void {
  console.log(`> ${command} ${args.join(" ")} (cwd: ${cwd})`);
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

interface CompileRouterOptions {
  clean: boolean;
}

function compileRouter(
  routerDir: string,
  { clean }: CompileRouterOptions,
): void {
  run("yarn", ["install", "--frozen-lockfile"], routerDir);
  if (clean) {
    run("forge", ["clean"], routerDir);
    run("forge", ["install"], routerDir);
  }
  run("forge", ["build"], routerDir);
}

function generateBytecode(routerDir: string): void {
  const forgeOut = join(routerDir, "forge-out");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: literal viem `0x${string}` type annotation emitted into generated source
  const address = "`0x${string}`";

  const lines: string[] = [];
  for (const name of BYTECODE_CONTRACTS) {
    const artifactPath = join(forgeOut, `${name}.sol`, `${name}.json`);
    if (!existsSync(artifactPath)) {
      // The set of contracts differs between branches (e.g. securitize-only
      // contracts are absent on main); skip whatever this branch did not build.
      console.warn(`Skipping ${name}: artifact not found at ${artifactPath}`);
      continue;
    }
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as {
      bytecode: { object: string };
    };
    lines.push(
      `export const ${name}_bytecode: ${address} = "${artifact.bytecode.object}";`,
    );
  }

  const out = join(packageDir, "src", "bytecode", "bytecode.generated.ts");
  writeFileSync(out, `${lines.join("\n")}\n`, "utf-8");
  console.log(`Wrote ${out}`);
}

function generateFrom(routerDir: string): void {
  run("pnpm", ["exec", "wagmi", "generate"], packageDir, {
    ROUTER_V3_DIR: routerDir,
  });

  generateBytecode(routerDir);

  run(
    "pnpm",
    [
      "exec",
      "biome",
      "check",
      "--write",
      "packages/liquidator-contracts/src/abi/abi.generated.ts",
      "packages/liquidator-contracts/src/bytecode/bytecode.generated.ts",
    ],
    repoRoot,
  );
}

function cloneRouter(ref: string): string {
  const tmp = mkdtempSync(join(tmpdir(), "router-v3-"));
  run(
    "git",
    [
      "clone",
      "--branch",
      ref,
      "--recurse-submodules",
      "--shallow-submodules",
      "--depth",
      "1",
      ROUTER_V3_REPO,
      tmp,
    ],
    repoRoot,
  );
  return tmp;
}

function main(): void {
  const {
    values: { branch, "source-dir": sourceDir },
  } = parseArgs({
    // Depending on how the script is invoked, package managers may forward a
    // literal `--` separator; drop it so `--branch` is parsed as an option.
    args: process.argv.slice(2).filter(arg => arg !== "--"),
    options: {
      branch: { type: "string", default: "main" },
      "source-dir": { type: "string" },
    },
  });

  if (sourceDir) {
    const routerDir = resolve(process.cwd(), sourceDir);
    if (!existsSync(routerDir)) {
      throw new Error(`source-dir does not exist: ${routerDir}`);
    }
    compileRouter(routerDir, { clean: true });
    generateFrom(routerDir);
    return;
  }

  const tmp = cloneRouter(branch ?? "main");
  try {
    compileRouter(tmp, { clean: false });
    generateFrom(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main();
