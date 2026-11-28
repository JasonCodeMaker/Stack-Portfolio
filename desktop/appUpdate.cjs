const RECHECK_MS = 6 * 60 * 60 * 1000;
const DISABLED_REASONS = ["unpackaged", "trial", "headless"];
const NOTES_LIMIT = 4000;
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

// Release notes arrive as text or HTML, or as a list with one entry per version. They are shown
// as plain text only, so nothing a release body contains can run or load inside the app.
function plainNotes(value) {
  const raw = Array.isArray(value) ? value.map((item) => item?.note ?? "").join("\n\n") : typeof value === "string" ? value : "";
  return raw
    .replace(/<\s*li[^>]*>/gi, "- ")
    .replace(/<\s*h[1-6][^>]*>/gi, "## ")
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/ul|\/ol|\/div)[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name) => ENTITIES[name])
    .replace(/[<>]/g, "")
    .split(/\r?\n/).map((line) => line.trim()).filter((line, i, all) => line || all[i - 1])
    .join("\n").trim().slice(0, NOTES_LIMIT);
}

// Owns the application-update state for one launch. The updater library is injected, so the
// module never loads Electron and every transition can be exercised with a fake emitter.
//
// States: disabled, idle, checking, current, downloading, ready, failed.
// A newer version downloads as soon as it is found. It is installed only when the user asks:
// never on an ordinary quit, and never to an older version.
//
// A ready update asks for attention once per version (`prompt`). After "later" it stays offered
// without asking again; after "skip" it is offered only where the user goes looking for it.
// `memory` keeps those two answers across launches.
function createAppUpdate({
  updater,
  disabledReason = null,
  onState = () => {},
  onNote = () => {},
  canCheck = () => true,
  beforeInstall = async () => {},
  memory = { read: () => ({}), write: () => {} },
  now = Date.now,
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  if (disabledReason !== null && !DISABLED_REASONS.includes(disabledReason)) throw Error("Unknown disabled reason");
  let state = Object.freeze(disabledReason ? { status: "disabled", reason: disabledReason } : { status: "idle" });
  let timer = null;
  let started = false;
  let installing = false;

  const set = (next) => {
    if (Object.keys(next).length === Object.keys(state).length &&
        Object.entries(next).every(([key, value]) => state[key] === value)) return;
    state = Object.freeze(next);
    onState(state);
  };
  const busy = () => ["checking", "downloading", "ready"].includes(state.status);
  const fail = (code) => {
    // A package that is already downloaded and validated stays offered; a later failed
    // check must not take it away.
    if (state.status === "ready" || state.status === "disabled") return;
    onNote(code);
    set({ status: "failed", checkedAt: now() });
  };
  const version = (info) => String(info?.version ?? "");
  const ready = (info) => {
    const next = version(info) || state.version || "";
    const { promptedVersion, skippedVersion } = memory.read() ?? {};
    const skipped = !!next && skippedVersion === next;
    return {
      status: "ready", version: next, notes: plainNotes(info?.releaseNotes),
      releaseDate: typeof info?.releaseDate === "string" ? info.releaseDate.slice(0, 10) : "",
      prompt: !skipped && promptedVersion !== next, skipped,
    };
  };
  const answer = (patch, flags) => {
    if (state.status !== "ready") return state;
    memory.write(patch);
    set({ ...state, ...flags });
    return state;
  };
  const listeners = {
    "update-available": (info) => set({ status: "downloading", version: version(info), percent: 0 }),
    "update-not-available": () => {
      if (state.status !== "ready") set({ status: "current", checkedAt: now() });
    },
    "download-progress": (progress) => {
      if (state.status !== "downloading") return;
      const percent = Math.max(0, Math.min(100, Math.floor(Number(progress?.percent) || 0)));
      // Progress never moves backwards on screen, whatever order the events arrive in.
      if (percent > state.percent) set({ ...state, percent });
    },
    "update-downloaded": (info) => set(ready(info)),
    error: () => fail(state.status === "downloading" ? "update_download_failed" : "update_check_failed"),
  };

  async function check() {
    if (state.status === "disabled" || busy() || installing || !canCheck()) return state;
    set({ status: "checking" });
    try {
      await updater.checkForUpdates();
      // The library resolves without an event when it has nothing to do.
      if (state.status === "checking") set({ status: "current", checkedAt: now() });
    } catch {
      if (state.status === "checking" || state.status === "downloading") fail("update_check_failed");
    }
    return state;
  }

  return {
    state: () => state,
    check,
    // Once after an installed update: what this launch was updated to. A launch that is not on
    // that version (the installation did not complete) reports nothing.
    takeInstalled(currentVersion) {
      const { installed } = memory.read() ?? {};
      if (!installed) return null;
      memory.write({ installed: null });
      return installed.version === currentVersion ? { version: installed.version, notes: String(installed.notes ?? "") } : null;
    },
    // "Later": keep offering this version, but do not ask again.
    later: () => answer({ promptedVersion: state.version }, { prompt: false }),
    // "Skip this version": stop offering it until a newer one arrives.
    skip: () => answer({ promptedVersion: state.version, skippedVersion: state.version }, { prompt: false, skipped: true }),
    start() {
      if (started || state.status === "disabled") return state;
      started = true;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      for (const [event, listener] of Object.entries(listeners)) updater.on(event, listener);
      timer = setTimer(() => void check(), RECHECK_MS);
      timer?.unref?.();
      void check();
      return state;
    },
    stop() {
      if (!started) return;
      started = false;
      clearTimer(timer);
      timer = null;
      for (const [event, listener] of Object.entries(listeners)) updater.removeListener(event, listener);
    },
    async install() {
      if (state.status !== "ready" || installing) return false;
      installing = true;
      try {
        // The caller closes the ledger here. If that fails the update stays offered.
        await beforeInstall();
        // Read back by the next launch, which tells the user what it was updated to.
        memory.write({ installed: { version: state.version, notes: state.notes } });
        updater.quitAndInstall(true, true);
        return true;
      } catch (error) {
        installing = false;
        onNote("update_install_failed");
        throw error;
      }
    },
  };
}

module.exports = { createAppUpdate, plainNotes, RECHECK_MS, DISABLED_REASONS };
