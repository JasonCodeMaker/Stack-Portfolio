const path = require("node:path");

const TRIAL_SWITCH = "--trial";
const PROFILE_NAME = "Stack Portfolio";
const TRIAL_PROFILE_NAME = "Stack Portfolio Trial";

// Decides where this launch keeps its ledger, key, preferences and diagnostics.
// A trial launch (`"Stock Portfolio.exe" --trial`) never shares a directory with a
// normal launch, so a release candidate can be tried without opening the real ledger.
// Electron fuses disable NODE_OPTIONS and runAsNode, so the switch is a plain argument.
function launchProfile({ argv, env, appData }) {
  const trial = argv.slice(1).includes(TRIAL_SWITCH);
  const normal = env.STACK_PORTFOLIO_TEST_DIR || path.join(appData, PROFILE_NAME);
  const userData = !trial ? normal
    : env.STACK_PORTFOLIO_TEST_DIR ? path.join(normal, "trial") : path.join(appData, TRIAL_PROFILE_NAME);
  return { trial, userData };
}

module.exports = { launchProfile, TRIAL_SWITCH, PROFILE_NAME, TRIAL_PROFILE_NAME };
