import { build } from "esbuild";

/**
 * Replaces ssh2 lib with dummy
 * ssh2 lib's dependencies use native modules
 * ssh2 lib itself is used by docker-modem only when conneciton path is specified as ssh, and we don't use this
 */
const ssh2Plugin = {
  name: "ssh2Killer",
  setup(build) {
    build.onResolve({ filter: /^ssh2$/ }, args => {
      return {
        path: args.path,
        namespace: "ssh2-ns",
      };
    });

    build.onLoad({ filter: /.*/, namespace: "ssh2-ns" }, () => ({
      contents: JSON.stringify({ Client: {} }),
      loader: "json",
    }));
  },
};

build({
  entryPoints: ["src/index.ts"],
  outdir: "build",
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  target: ["node24"],
  plugins: [ssh2Plugin],
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
}).catch(e => {
  console.error(e);
  process.exit(1);
});
