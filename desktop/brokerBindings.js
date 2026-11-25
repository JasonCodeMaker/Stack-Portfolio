import { account, createAccount, preference, putPref, transaction, BROKER } from "./ledger";

const records = "broker-account";
const vault = "broker-account-credentials";

export function bindings(db) {
  return db
    .prepare(
      "SELECT p.key AS id, p.value, a.name FROM sp_prefs p JOIN sp_accounts a ON a.id=p.key WHERE p.scope=? ORDER BY a.name",
    )
    .all(records)
    .map(({ value, ...row }) => ({
      ...row,
      ...JSON.parse(value),
      authorized: Boolean(preference(db, vault, row.id)),
    }));
}

export function bindingFor(db, id) {
  const raw = preference(db, records, id);
  return raw ? JSON.parse(raw) : null;
}

export function credentialsFor(db, id, storage) {
  try {
    const encrypted = preference(db, vault, id);
    if (encrypted) return JSON.parse(storage.decryptString(Buffer.from(encrypted, "base64")));
  } catch {}
  throw Error("此账户的授权不可用。请到「设置 → 券商连接 → 添加或重新授权账户」重新连接。");
}

export function savedWebullToken(db, storage, credentials) {
  for (const binding of bindings(db)) {
    if (binding.broker !== "webull" || !binding.authorized) continue;
    let prior;
    try { prior = credentialsFor(db, binding.id, storage); } catch { continue; }
    if (prior.appKey === credentials.appKey && prior.appSecret === credentials.appSecret) return prior.accessToken;
  }
}

export function saveBinding(db, storage, draft, { remoteId, localId, name, currency }) {
  const remote = draft.accounts.find((a) => a.accountId === remoteId);
  if (!remote) throw Error("请从本次券商返回的账户中选择。");
  if (!localId && (typeof name !== "string" || !name.trim() || name.length > 120))
    throw Error("请填写有效的本地账户名称。");
  if (!storage.isEncryptionAvailable()) throw Error("Windows 凭据保护不可用，请稍后重试。");
  const encrypted = storage
    .encryptString(JSON.stringify({ ...draft.credentials, accountId: remoteId }))
    .toString("base64");
  return transaction(db, () => {
    const existing = bindings(db).find((b) => b.broker === draft.broker && b.remoteId === remoteId);
    if (existing && localId !== existing.id)
      throw Error("该券商账户已绑定到「" + existing.name + "」。请选择原账户以更新授权。");
    const id = localId || createAccount(db, name, currency);
    const local = account(db, id),
      prior = bindingFor(db, id);
    if (!local.active || local.mode !== "TRANSACTIONS") throw Error("请选择启用的交易账户。");
    if (prior && (prior.remoteId !== remoteId || prior.broker !== draft.broker))
      throw Error("这个本地账户已经绑定了其他券商账户。");
    const record = { broker: draft.broker, remoteId, suffix: (remote.accountNumber || remoteId).slice(-4) };
    putPref(db, records, id, JSON.stringify(record));
    putPref(db, vault, id, encrypted);
    putPref(db, BROKER, "local-account." + draft.broker, id);
    return { ...record, id, name: local.name, authorized: true };
  });
}

export function disconnectBinding(db, id) {
  if (!bindingFor(db, id)) throw Error("找不到账户绑定。");
  putPref(db, vault, id, null);
}
