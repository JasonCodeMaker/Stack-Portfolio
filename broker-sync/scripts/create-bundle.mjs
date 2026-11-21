import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

// The archive is written here rather than shelled out to `Compress-Archive`.
// Windows PowerShell 5.1 names nested entries with the OS separator, producing
// `dist\addon.js`. ZIP requires `/` (APPNOTE 4.4.17.1), so extractors create a
// single oddly named file instead of a dist folder, the manifest entry point
// never resolves, and Wealthfolio fails to analyse the add-on's permissions.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosStamp(modified) {
  const year = Math.max(modified.getFullYear(), 1980);
  return {
    time: (modified.getHours() << 11) | (modified.getMinutes() << 5) | (modified.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((modified.getMonth() + 1) << 5) | modified.getDate(),
  };
}

function writeZip(archivePath, entries) {
  const payloads = [];
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    if (name.includes(0x5c)) throw new Error(`ZIP entry names must use forward slashes: ${entry.name}`);
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const compressed = deflated.length < entry.data.length;
    const body = compressed ? deflated : entry.data;
    const method = compressed ? 8 : 0;
    const crc = crc32(entry.data);
    const stamp = dosStamp(entry.modified);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    payloads.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  writeFileSync(archivePath, Buffer.concat([...payloads, centralDirectory, end]));
}

function centralDirectoryNames(archivePath) {
  const buffer = readFileSync(archivePath);
  let end = -1;
  for (let cursor = buffer.length - 22; cursor >= 0; cursor -= 1) {
    if (buffer.readUInt32LE(cursor) === 0x06054b50) {
      end = cursor;
      break;
    }
  }
  if (end < 0) throw new Error("The generated archive has no end-of-central-directory record.");
  const total = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const names = [];
  for (let index = 0; index < total; index += 1) {
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    names.push(buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const release = join(root, "release");
const manifestPath = join(root, "manifest.json");
if (!existsSync(manifestPath)) throw new Error("manifest.json is missing.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const entryName = String(manifest.main).replaceAll("\\", "/");
const entryPath = join(root, ...entryName.split("/"));
if (!existsSync(entryPath)) throw new Error(`Build output is missing; run npm run build first (${entryName}).`);

const entries = [
  { name: "manifest.json", path: manifestPath },
  { name: entryName, path: entryPath },
].map((entry) => ({
  name: entry.name,
  data: readFileSync(entry.path),
  modified: statSync(entry.path).mtime,
}));

mkdirSync(release, { recursive: true });
const archive = join(release, `broker-sync-${manifest.version}.zip`);
rmSync(archive, { force: true });
writeZip(archive, entries);

// Never ship an archive Wealthfolio cannot load: read back what was written.
const names = centralDirectoryNames(archive);
if (!names.includes(entryName)) {
  throw new Error(`The archive does not contain the manifest entry point ${entryName}: ${names.join(", ")}`);
}
if (!names.includes("manifest.json")) throw new Error("The archive does not contain manifest.json.");
console.log(`Created ${archive} (${names.join(", ")})`);
