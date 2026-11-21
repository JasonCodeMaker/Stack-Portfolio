const path = require("node:path");
const { spawn } = require("node:child_process");
const { AddonDevServer } = require("@wealthfolio/addon-dev-tools/dev-server");

const addonPath = path.resolve(__dirname, "..");
const manifestPath = path.join(addonPath, "manifest.json");
const viteEntry = path.resolve(path.dirname(require.resolve("vite")), "../../bin/vite.js");
const config = {
  port: Number(process.env.WEALTHFOLIO_ADDON_PORT || 3001),
  addonPath,
  manifestPath,
  buildCommand: null,
  watchPaths: [
    path.join(addonPath, "src"),
    path.join(addonPath, "assets"),
    path.join(addonPath, "dist"),
    manifestPath,
  ],
};

const server = new AddonDevServer(config);
server.viteWatcher = spawn(process.execPath, [viteEntry, "build", "--watch"], {
  cwd: addonPath,
  stdio: "inherit",
});
server.start();
