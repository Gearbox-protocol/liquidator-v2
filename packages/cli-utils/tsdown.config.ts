import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", node: "src/node/index.ts" },
  outDir: "dist",
  format: ["esm"],
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node24",
});
