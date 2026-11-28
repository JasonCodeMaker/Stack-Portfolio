const RECHECK_MS = 6 * 60 * 60 * 1000;
const DISABLED_REASONS = ["unpackaged", "trial", "headless"];

// Owns the application-update state for one launch. The updater library is injected, so the
// module never loads Electron and every transition can be exercised with a fake emitter.
//
// States: disabled, idle, checking, current, downloading, ready, failed.
// A newer version downloads as soon as it is found. It is installed only when the user asks:
// never on an ordinary quit, and never to an older version.
function createAppUpdate({
  updater,
  disabledReason = null,
  onState = () => {},
  onNote = () => {},
  canCheck = () => true,
  beforeInstall = async () => {},
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
    "update-downloaded": (info) => set({ status: "ready", version: version(info) || state.version || "" }),
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

module.exports = { createAppUpdate, RECHECK_MS, DISABLED_REASONS };
