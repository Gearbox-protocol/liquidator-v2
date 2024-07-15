import { build } from "esbuild";

build({
  entryPoints: ["src/index.ts"],
  outdir: "build",
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  target: ["node20"],
  sourcemap: "external",
  banner: {
    js: `
      import { createRequire } from 'module';
      import { fileURLToPath } from 'url';

      const require = createRequire(import.meta.url);
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
    `,
  },
  external: ["node-pty"],
}).catch(e => {
  console.error(e);
  process.exit(1);
});
