import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "dist",
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node24",
  outExtension: () => ({ js: ".mjs" }),
  external: [
    "zod",
    "viem",
    "@gearbox-protocol/sdk",
    "@gearbox-protocol/cli-utils",
  ],
});
