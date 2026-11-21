import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

// Read the central directory directly. `tar` cannot open zip archives on every
// platform, and any reader that silently normalises separators would hide the
// exact defect these tests guard against.
function zipEntryNames(archivePath: string): string[] {
  if (!existsSync(archivePath)) {
    throw new Error(`${archivePath} is missing. Run "npm run bundle" before the bundle tests.`);
  }
  const buffer = readFileSync(archivePath);
  let endOfCentralDirectory = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOfCentralDirectory = offset;
      break;
    }
  }
  if (endOfCentralDirectory < 0) throw new Error(`${archivePath} has no ZIP end-of-central-directory record.`);

  const entryCount = buffer.readUInt16LE(endOfCentralDirectory + 10);
  let offset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  const names: string[] = [];
  for (let entry = 0; entry < entryCount; entry += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error(`${archivePath} has a malformed central directory.`);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

describe("release bundle", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(projectRoot, "manifest.json"), "utf8"),
  ) as { version: string; main: string };
  const archive = resolve(projectRoot, "release", `broker-sync-${manifest.version}.zip`);

  it("stores the manifest entry point under the exact path Wealthfolio loads", () => {
    expect(zipEntryNames(archive)).toContain(manifest.main);
  });

  it("names every entry with ZIP forward slashes so extraction recreates dist/", () => {
    expect(zipEntryNames(archive).filter((name) => name.includes("\\"))).toEqual([]);
  });

  it("ships the manifest next to the entry point", () => {
    expect(zipEntryNames(archive)).toContain("manifest.json");
  });
});
