import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = join(root, "release");
const staging = join(release, ".staging");
const manifest = join(root, "manifest.json");
const builtAddon = join(root, "dist", "addon.js");
if (!existsSync(manifest) || !existsSync(builtAddon)) throw new Error("Build output is missing; run npm run build first.");

rmSync(staging, { recursive: true, force: true });
mkdirSync(staging, { recursive: true });
cpSync(manifest, join(staging, "manifest.json"));
cpSync(builtAddon, join(staging, "addon.js"));
const version = JSON.parse(readFileSync(manifest, "utf8")).version;
const archive = join(release, `portfolio-xray-${version}.zip`);
rmSync(archive, { force: true });

if (process.platform === "win32") {
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Compress-Archive -LiteralPath '${join(staging, "manifest.json")}', '${join(staging, "addon.js")}' -DestinationPath '${archive}'`], { stdio: "inherit" });
} else {
  execFileSync("zip", ["-q", archive, "manifest.json", "addon.js"], { cwd: staging, stdio: "inherit" });
}
rmSync(staging, { recursive: true, force: true });
console.log(`Created ${archive}`);
