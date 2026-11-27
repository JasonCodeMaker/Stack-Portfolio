const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { AsyncLocalStorage } = require("node:async_hooks");
const { randomUUID } = require("node:crypto");

const day = 86_400_000;
const segmentBytes = 1024 * 1024;
const segmentCount = 5;
const segmentName = /^events-(\d{13})\.jsonl$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const version = /^\d{1,5}\.\d{1,5}\.\d{1,5}$/;
const stages = new Set([
  "dispatch", "queue", "execute", "validate", "pick", "fetch", "parse", "preview", "commit",
  "open", "protect", "configure", "createWindow", "load", "preload", "render", "async", "event",
  "preferences", "layout", "close", "integrity", "replace", "activate", "rollback", "cache", "report", "export",
]);
const reasons = new Set([
  "unexpected_error", "storage_unavailable", "partial_sync", "login_required", "stale_cache",
  "source_unavailable", "cache_unavailable", "renderer_gone", "renderer_unresponsive", "child_gone",
  "preload_failed", "rollback_completed",
]);
const outcomes = new Set(["started", "succeeded", "failed", "degraded", "cancelled", "marked"]);
const processes = new Set(["main", "renderer", "child"]);
const providers = new Set(["ibkr", "webull"]);
const uiStages = new Set(["render", "async", "event"]);
const screens = new Set(["startup", "overview", "performance", "allocation", "holdings", "macro", "imports", "settings", "welcome", "onboarding"]);
const own = (set, value) => typeof value === "string" && set.has(value);

function createDiagnostics({ directory, build, operations, paused = false, now = Date.now }) {
  const enabledOperations = new Set([...operations, ...screens]);
  const context = new AsyncLocalStorage();
  const runId = randomUUID();
  const buildVersion = typeof build === "string" && version.test(build) ? build : "0.0.0";
  const repeats = new Map();
  let queue = Promise.resolve();
  let pending = 0;
  let seq = 0;
  let closed = false;
  let gap = false;
  let nextPrune = 0;
  let segments = [];
  let snapshot;
  let maintenance;

  function safeRecord(value) {
    if (!value || value.schema !== 1 || typeof value.build !== "string" || !version.test(value.build) ||
        typeof value.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.at) ||
        typeof value.run !== "string" || !uuid.test(value.run) || typeof value.id !== "string" || !uuid.test(value.id) ||
        !Number.isSafeInteger(value.seq) || value.seq < 1 ||
        !own(enabledOperations, value.operation) || !own(processes, value.process) ||
        !own(stages, value.stage) || !own(outcomes, value.outcome)) return;
    const { schema, at, build, run, seq, id, operation, process, stage, outcome } = value;
    return {
      schema, at, build, run, seq, id, operation, process, stage, outcome,
      ...(own(reasons, value.reason) ? { reason: value.reason } : {}),
      ...(own(providers, value.provider) ? { provider: value.provider } : {}),
    };
  }

  function schedule(work) {
    pending++;
    const result = queue.then(work);
    queue = result.then(() => { pending--; }, () => { pending--; gap = true; });
    return result;
  }

  async function prune() {
    await fs.mkdir(directory, { recursive: true });
    if (!(await fs.lstat(directory)).isDirectory()) throw Error("Diagnostics directory unavailable");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = entries.filter((entry) => segmentName.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
    segments = [];
    for (const [index, entry] of files.entries()) {
      const file = path.join(directory, entry.name);
      const created = Number(segmentName.exec(entry.name)[1]);
      if (!entry.isFile()) {
        gap = true;
        continue;
      }
      const { size } = await fs.stat(file);
      if (created < now() - 7 * day || size > segmentBytes || files.length - index > segmentCount) {
        await fs.unlink(file);
      } else {
        segments.push({ file, size, created });
      }
    }
    nextPrune = now() + 60_000;
  }

  async function write(record) {
    if (now() >= nextPrune) await prune();
    const line = JSON.stringify(record) + "\n";
    const bytes = Buffer.byteLength(line);
    let active = segments.at(-1);
    if (!active || active.size + bytes + 1 > segmentBytes) {
      if (segments.length >= segmentCount) {
        await fs.unlink(segments[0].file);
        segments.shift();
      }
      const stamp = Math.max(now(), (active?.created ?? 0) + 1);
      const file = path.join(directory, `events-${stamp}.jsonl`);
      await fs.writeFile(file, line, { flag: "wx", mode: 0o600 });
      segments.push({ file, size: bytes, created: stamp, complete: true });
      return;
    }
    try {
      const stat = await fs.lstat(active.file);
      if (!stat.isFile() || stat.size !== active.size) throw Error("Diagnostic segment changed");
      let separator = "";
      if (!active.complete && active.size) {
        // Keep new records readable if an interrupted write left a partial line.
        const handle = await fs.open(active.file, "r");
        try {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, active.size - 1);
          if (last[0] !== 10) separator = "\n";
        } finally {
          await handle.close();
        }
      }
      await fs.appendFile(active.file, separator + line, "utf8");
      active.size += bytes + separator.length;
      active.complete = true;
    } catch (error) {
      nextPrune = 0;
      throw error;
    }
  }

  function emit(operation, process, stage, outcome, reason, provider, id = randomUUID()) {
    if (paused || closed) return;
    if (pending >= 256) {
      gap = true;
      return;
    }
    const record = safeRecord({
      schema: 1, at: new Date(now()).toISOString(), build: buildVersion, run: runId, seq: ++seq,
      id, operation, process, stage, outcome, reason, provider,
    });
    if (!record) return;
    if (reason) {
      const key = [operation, process, stage, reason, provider].join("/");
      const last = repeats.get(key);
      if (last != null && now() - last < 30_000) return;
      if (repeats.size >= 256) repeats.delete(repeats.keys().next().value);
      repeats.set(key, now());
    }
    void schedule(() => write(record)).catch(() => {});
  }

  function stage(value) {
    const current = context.getStore();
    if (current && own(stages, value)) current.stage = value;
  }

  function note(reason, provider, outcome = "degraded") {
    const current = context.getStore();
    if (!current) return;
    current.degraded ||= outcome === "degraded";
    emit(current.operation, "main", current.stage, outcome, reason, provider, current.id);
  }

  async function branch(work) {
    const parent = context.getStore();
    if (!parent) return work();
    const child = { ...parent };
    try {
      return await context.run(child, work);
    } finally {
      parent.degraded ||= child.degraded;
    }
  }

  async function run(operation, initialStage, work, milestones = false) {
    const current = { operation, stage: initialStage, id: randomUUID(), degraded: false };
    return context.run(current, async () => {
      if (milestones) emit(operation, "main", initialStage, "started", undefined, undefined, current.id);
      try {
        const result = await work();
        if (milestones) {
          const outcome = current.degraded ? "degraded" : result === null ? "cancelled" : "succeeded";
          emit(operation, "main", current.stage, outcome, undefined, undefined, current.id);
        }
        return result;
      } catch (error) {
        emit(operation, "main", current.stage, "failed", "unexpected_error", undefined, current.id);
        throw error;
      }
    });
  }

  function renderer(screen, stage) {
    if (own(screens, screen) && own(uiStages, stage)) emit(screen, "renderer", stage, "failed", "unexpected_error");
  }

  function mark(screen) {
    if (own(screens, screen)) emit(screen, "renderer", "report", "marked");
  }

  async function preview(range) {
    return schedule(async () => {
      try {
        await prune();
      } catch {
        gap = true;
      }
      const cutoff = now() - (range === "all" ? 7 : 1) * day;
      const records = [];
      for (const segment of segments) {
        try {
          const stat = await fs.lstat(segment.file);
          if (!stat.isFile() || stat.size > segmentBytes) { gap = true; continue; }
          const content = await fs.readFile(segment.file, "utf8");
          for (const line of content.trimEnd().split("\n")) {
            if (!line) continue;
            try {
              const record = safeRecord(JSON.parse(line));
              if (!record) gap = true;
              else if (Date.parse(record.at) >= cutoff) records.push(record);
            } catch {
              gap = true;
            }
          }
        } catch {
          gap = true;
        }
      }
      let selected = records;
      if (range === "recent") {
        const latest = records.findLast((event) => ["failed", "degraded", "marked"].includes(event.outcome));
        if (latest && latest.outcome !== "marked") selected = records.filter((event) => event.id === latest.id);
        if (latest?.outcome === "marked") selected = records.filter((event) =>
          Math.abs(Date.parse(event.at) - Date.parse(latest.at)) <= 15 * 60_000);
      }
      const previousBoot = records.findLast((event) => event.operation === "startup" &&
        event.outcome === "started" && event.run !== runId);
      const previousRunIncomplete = Boolean(previousBoot && !records.some((event) =>
        event.run === previousBoot.run && event.operation === "shutdown"));
      const incomplete = gap || previousRunIncomplete;
      const osRelease = os.release();
      const header = {
        schema: 1, type: "diagnostics", build: buildVersion, range, incomplete,
        platform: process.platform, arch: process.arch,
        ...(version.test(osRelease) ? { osRelease } : {}),
      };
      const text = [header, ...selected].map((row) => JSON.stringify(row)).join("\n") + "\n";
      snapshot = { id: randomUUID(), text, count: selected.length, paused, incomplete };
      return snapshot;
    });
  }

  async function clear() {
    snapshot = undefined;
    await schedule(async () => {
      snapshot = undefined;
      nextPrune = 0;
      await prune();
      for (const segment of segments) await fs.unlink(segment.file);
      segments = [];
      repeats.clear();
      gap = false;
    });
  }

  return {
    emit, run, stage, note, branch, renderer, mark, preview, clear,
    start() {
      const maintain = () => { if (!closed) void schedule(prune).catch(() => {}); };
      maintain();
      maintenance = setInterval(maintain, 60 * 60_000).unref();
    },
    snapshot: (id) => snapshot?.id === id ? snapshot?.text : undefined,
    setPaused(value) { paused = value; },
    stop() {
      clearInterval(maintenance);
      closed = true;
      snapshot = undefined;
      return queue;
    },
  };
}

module.exports = { createDiagnostics };
