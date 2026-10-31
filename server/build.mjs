#!/usr/bin/env node
/**
 * The server bundle. It imports the client's CONTENT TREE (src/world/domains) to read the worlds as
 * data, and that tree's views import three.js and React-Three-Fiber — which must never reach the
 * server. The walker reads element objects and never renders one, so none of that code is ever
 * CALLED here; it only has to EVALUATE at import. So those packages are replaced with one stub
 * module that answers anything (`stubbed` below), and `.glsl` is loaded as text.
 *
 * `three` stays external as well, so if real three ever reaches the server the boot fails loudly
 * instead of silently shipping a renderer.
 */
import { build, context } from "esbuild";
import { spawn } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * A module whose every export is a proxy that can be read, called, constructed and iterated.
 *
 * It is exported as a plain object whose PROTOTYPE is that proxy, because esbuild's CJS→ESM interop
 * rebuilds the namespace as `Object.create(getPrototypeOf(exports))` and then copies the OWN keys —
 * of which a catch-all proxy has none. Inherited, every named import resolves through the trap.
 */
const STUB = `
const make = () => new Proxy(function () {}, {
  get: (t, k) =>
    k === Symbol.toPrimitive ? () => 0
    : k === Symbol.iterator ? function* () {}
    : k === "then" ? undefined
    : k === "prototype" ? t.prototype
    : make(),
  set: () => true,
  has: () => true,
  apply: () => make(),
  construct: () => make(),
});
module.exports = Object.create(make());
`;

/** Everything the views draw with. Nothing here runs on the server. */
const STUBBED = [
  "three",
  "three/examples/jsm/utils/BufferGeometryUtils",
  "three/examples/jsm/loaders/GLTFLoader",
  "@react-three/fiber",
  "@react-three/drei",
  "@react-three/drei/core/useGLTF",
  "@react-three/rapier",
  "@react-three/postprocessing",
  "postprocessing",
  "maath",
  "maath/random",
  "react-dom",
  "react-dom/client",
];

const stubbed = {
  name: "stub-renderer-packages",
  setup(b) {
    const filter = new RegExp(`^(${STUBBED.map((m) => m.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")).join("|")})$`);
    b.onResolve({ filter }, (args) => ({ path: args.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: STUB, loader: "js" }));
  },
};

/** The ONE build: `npm run build`, the dev watcher, the tests' bundle, and the test that asserts
 *  no renderer reached the server all go through this. */
export const buildOptions = ({ tests = false } = {}) => ({
  entryPoints: tests
    ? readdirSync(new URL("test", import.meta.url))
        .filter((f) => f.endsWith(".test.ts"))
        .map((f) => `test/${f}`)
    : [
        "src/index.ts",
        "src/game/physics/chunkGenerator.worker.ts",
        "src/cli/migrate.ts",
        "src/cli/inspect.ts",
        "src/cli/physicsDemo.ts",
      ],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  outdir: tests ? "dist-test" : "dist",
  outbase: tests ? "test" : "src",
  sourcemap: true,
  logLevel: "warning",
  // Rapier, delaunator, noise-ts and seedrandom are BUNDLED from the ROOT install, so the client
  // and the server can never run different copies (server/DECISIONS.md).
  // esbuild only for the test that bundles the server to assert no renderer reached it.
  external: ["express", "ws", "three", ...(tests ? ["esbuild"] : [])],
  loader: { ".glsl": "text", ".png": "dataurl", ".jpg": "dataurl" },
  plugins: [stubbed],
  define: { "process.env.NODE_ENV": tests ? '"test"' : '"production"' },
});

// Only when run as a script: the bundle test imports buildOptions from here.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const options = buildOptions({ tests: process.argv.includes("--tests") });
  rmSync(options.outdir, { recursive: true, force: true });
  if (process.argv.includes("--watch")) {
    // The server is started HERE, after the first build, rather than beside the watcher in the npm
    // script: `node --watch` racing a cold build would boot with no dist, and a backgrounded
    // watcher is one more process for Ctrl+C to miss.
    let server = null;
    const started = {
      name: "run-after-first-build",
      setup(b) {
        b.onEnd((result) => {
          if (result.errors.length || server) return;
          server = spawn("node", ["--env-file-if-exists=.env", "--watch", "dist/index.js"], { stdio: "inherit" });
          server.on("exit", (code) => process.exit(code ?? 0));
        });
      },
    };
    const ctx = await context({ ...options, plugins: [...options.plugins, started] });
    await ctx.watch();
    console.log(`[build] watching → ${options.outdir}/`);
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        server?.kill(signal);
        ctx.dispose().finally(() => process.exit(0));
      });
    }
  } else {
    await build(options);
  }
}
