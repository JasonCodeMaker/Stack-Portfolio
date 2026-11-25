// Run with Node after building desktop. An optional argument is the inline preview path.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { createRequire } = require("node:module");
const desktop = path.resolve(__dirname, "../../../../../desktop");
const appRequire = createRequire(path.join(desktop, "package.json"));
const { createBook } = appRequire("./out/ledger.cjs");
const { seedDemo } = appRequire("./out/demo.cjs");
const { dashboard } = appRequire("./out/flows.cjs");

async function snapshots() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d02-overview-"));
  const file = path.join(dir, "sample.sqlite");
  const db = createBook(file, Buffer.from("raw:" + crypto.randomBytes(32).toString("hex")));
  const data = {};
  try {
    await seedDemo(db);
    for (const sample of ["a", "b"]) {
      // Withhold every usable BHP price in this disposable book. Units, accounts, cash
      // and activities stay identical. Removing only the last quote would allow fallback.
      if (sample === "b") db.prepare("DELETE FROM sp_prices WHERE asset = ?").run("bhp");
      for (const scope of ["all", "ibkr", "webull"]) {
        const ids = scope === "all" ? "all" : ["demo-" + scope];
        for (const period of ["1d", "1w", "mtd", "3m", "6m", "ytd", "1y", "all"]) {
          const d = await dashboard(db, { ids, period, date: "", current: false });
          data[[sample, scope, period].join("/")] = Object.fromEntries([
            "selected", "accounts", "date", "end", "start", "summary", "rows", "byAccount",
            "breakdown", "holdings", "points", "fx", "valuation", "securities", "today",
            "currentMarket", "known", "portfolio", "listings", "settings",
          ].map(key => [key, d[key]]));
        }
      }
    }
    return data;
  } finally {
    db.close();
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
}

async function build() {
  const data = await snapshots();
  const built = await appRequire("esbuild").build({
    entryPoints: [path.join(__dirname, "comparison.jsx")], absWorkingDir: desktop,
    nodePaths: [path.join(desktop, "node_modules")], alias: { "@desktop": desktop },
    bundle: true, write: false, outdir: "out", jsx: "automatic", minify: true,
    // The seeded ledger contains only cash transfers. Its securities have no trade history.
    define: { "process.env.NODE_ENV": '"production"', "window.portfolio": "readOnlySampleBook" },
    banner: { js: "var readOnlySampleBook={history:async()=>[]};" }, target: "chrome120",
    legalComments: "none", loader: { ".css": "css" },
  });
  const js = built.outputFiles.find(o => o.path.endsWith(".js")).text;
  const css = built.outputFiles.find(o => o.path.endsWith(".css")).text
    .replaceAll(":root", ":host").replace(/\bbody\s*\{/g, ".d02-body{");
  const fixture = zlib.gzipSync(JSON.stringify(data), { level: 9 }).toString("base64");
  const fragment = fs.readFileSync(path.join(__dirname, "stage.html"), "utf8")
    .replace("__FIXTURE__", () => JSON.stringify(fixture))
    .replace("__SCRIPT__", () => ("const D02_STYLE=" + JSON.stringify(css) + ";\n" + js).replace(/<\/script/gi, "<\\/script"));
  if (Buffer.byteLength(fragment) > 1_000_000) throw Error("Inline comparison exceeds the host size limit");
  if (process.argv[2]) fs.writeFileSync(process.argv[2], fragment);
  const standalone = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>D02 · 总览对照</title><style>body{margin:0;background:light-dark(#edf2ed,#101813);font-family:system-ui,sans-serif}#portfolio-overview-comparison{max-width:1800px;margin:auto}#d02-views{display:flex;gap:4px;padding:10px 12px;flex-wrap:wrap;background:light-dark(#e2eae4,#18231c)}#d02-views button{font:inherit;padding:.4em .8em;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer}#d02-views button[aria-pressed=true]{background:light-dark(#15563f,#99d7b8);color:light-dark(white,#112119)}[hidden]{display:none!important}</style></head><body>' +
    fragment + '<script>' + fs.readFileSync(path.join(__dirname, "standalone-nav.js"), "utf8") + '</script></body></html>';
  fs.writeFileSync(path.join(__dirname, "index.html"), standalone);
  console.log(Object.keys(data).length + " matched snapshots; " + Buffer.byteLength(fragment) + " inline bytes");
}
build().catch(e => { console.error(e); process.exitCode = 1; });
