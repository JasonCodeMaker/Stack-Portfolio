// Loads the built main process with a stand-in for Electron and reports which profile
// directory it chose. Run as a child process: node boot-main.cjs <appData> [app args...]
const Module = require("node:module");
const path = require("node:path");

const [appData, ...args] = process.argv.slice(2);
process.argv = [process.execPath, ...args];
const paths = { appData };
const anything = () => new Proxy(function () {}, { get: (_, key) => (key === "then" ? undefined : anything()), apply: () => anything() });
const app = new Proxy({
  setName() {},
  getVersion: () => "0.0.0-test",
  getPath: (name) => paths[name] ?? path.join(appData, "unexpected-" + name),
  setPath(name, value) { paths[name] = value; },
  requestSingleInstanceLock: () => true,
  whenReady: () => new Promise(() => {}),
  on() {},
  exit(code) { throw Error("app.exit(" + code + ")"); },
}, { get: (target, key) => target[key] ?? anything() });
const electron = new Proxy({ app }, { get: (target, key) => target[key] ?? anything() });
const load = Module._load;
Module._load = function (request, ...rest) {
  return request === "electron" ? electron : load.call(this, request, ...rest);
};
require(path.join(__dirname, "..", "..", "out", "main.cjs"));
// Give asynchronous startup work (diagnostics maintenance) time to reach the disk.
setTimeout(() => {
  console.log(JSON.stringify({ userData: paths.userData }));
  process.exit(0);
}, 500);
