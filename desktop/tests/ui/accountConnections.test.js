import { describe, expect, it } from "vitest";
import { accountBroker, accountConnection, connectionHealth, lastBatches, syncTargets } from "../../ui/accountConnections.js";

const accounts = [
  { id: "a", name: "IBKR main", active: true, mode: "TRANSACTIONS" },
  { id: "b", name: "Webull AU", active: true, mode: "TRANSACTIONS" },
  { id: "c", name: "Stake", active: true, custom: true },
  { id: "d", name: "Spare", active: true, mode: "TRANSACTIONS" },
  { id: "e", name: "Closed", active: false, mode: "TRANSACTIONS" },
];
const mapping = { ibkr: "", webull: "b" };
const conn = {
  bindings: [{ id: "a", broker: "ibkr", suffix: "1001", authorized: true }],
  present: {},
  query: "",
  verified: {},
  lastSuccess: {},
};

describe("account connections", () => {
  it("takes the broker from the account's own binding before the shared mapping", () => {
    expect(accountBroker(accounts[0], conn, { ibkr: "d" })).toBe("ibkr");
    expect(accountBroker(accounts[1], conn, mapping)).toBe("webull");
    expect(accountBroker(accounts[2], conn, mapping)).toBe(null);
    expect(accountBroker(accounts[3], conn, mapping)).toBe(null);
  });

  it("describes bound, shared, custom and unconnected accounts", () => {
    expect(accountConnection(accounts[0], conn, mapping)).toMatchObject({ kind: "binding", tone: "up", label: "已连接", suffix: "1001" });
    expect(accountConnection(accounts[1], conn, mapping)).toMatchObject({ kind: "shared", broker: "webull", tone: "warn", label: "待授权" });
    expect(accountConnection(accounts[2], conn, mapping)).toMatchObject({ kind: "custom", syncable: false });
    expect(accountConnection(accounts[3], conn, mapping)).toMatchObject({ kind: "none", label: "未连接", syncable: false });
    const lapsed = { ...conn, bindings: [{ ...conn.bindings[0], authorized: false }] };
    expect(accountConnection(accounts[0], lapsed, mapping)).toMatchObject({ tone: "warn", label: "需重新授权" });
  });

  it("waits for the saved connections before claiming a state, except in the sample book", () => {
    expect(accountConnection(accounts[1], null, mapping)).toMatchObject({ kind: "loading", syncable: false });
    expect(accountConnection(accounts[1], null, mapping, true)).toMatchObject({ kind: "sample", tone: "up", syncable: true });
  });

  it("updates every active broker account with a known broker, in list order", () => {
    expect(syncTargets(accounts, conn, mapping)).toEqual([
      { account: "a", broker: "ibkr" },
      { account: "b", broker: "webull" },
    ]);
    expect(syncTargets([{ ...accounts[0], mode: "HOLDINGS" }], conn, mapping)).toEqual([]);
  });

  it("counts working connections among active broker accounts", () => {
    expect(connectionHealth(accounts, conn, mapping)).toEqual({ total: 3, ok: 1 });
  });

  it("keeps the newest batch time of each account", () => {
    expect(lastBatches([
      { account: "a", created: "2026-11-01T10:00:00Z" },
      { account: "a", created: "2026-11-20T10:00:00Z" },
      { account: "b", created: "2026-11-05T10:00:00Z" },
    ])).toEqual({ a: "2026-11-20T10:00:00Z", b: "2026-11-05T10:00:00Z" });
  });
});
