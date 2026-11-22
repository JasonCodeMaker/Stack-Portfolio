import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(desktop, "out");
await mkdir(output, { recursive: true });
const shared = {
  bundle: true,
  logLevel: "warning",
  jsx: "automatic",
};
await Promise.all([
  build({
    ...shared,
    entryPoints: ["main.cjs", "ledger.js", "flows.js", "services.js", "demo.js", "performance.js", "periodSummary.js", "reviewMarket.js"].map((x) =>
      path.join(desktop, x),
    ),
    platform: "node",
    target: "node22",
    format: "cjs",
    outdir: output,
    outExtension: { ".js": ".cjs" },
    external: ["electron", "better-sqlite3-multiple-ciphers"],
  }),
  build({
    ...shared,
    entryPoints: [path.join(desktop, "ui/App.jsx")],
    platform: "browser",
    target: "chrome130",
    outfile: path.join(output, "app.js"),
    minify: true,
    legalComments: "eof",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  ...["index.html", "preload.cjs"].map((x) => cp(path.join(desktop, x), path.join(output, x))),
]);
