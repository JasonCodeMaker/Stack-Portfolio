import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Layers3, WalletCards } from "lucide-react";
import { api, Field } from "../common";
import { Mark } from "../Shell";
import { brokerNames, brokerGuides } from "./brokerGuide";
import { FieldSource, StepNotes } from "./StepNotes";
import { TutorialLauncher } from "./Tutorial";
import { PhoneGuide } from "./PhoneGuide";
import { Screenshots } from "./Screenshots";
import "./wizard.css";
import "./studio.css";

const headings = {
  welcome: "现在添加第一个账户吗？",
  broker: "这个账户在哪家券商？",
  account: "确认要绑定的账户",
  bound: "还要继续添加账户吗？",
};
const descriptions = {
  welcome: "跟随券商图文教程，将一个投资账户接入本地账本。你也可以稍后再设置。",
  broker: "只选择当前账户使用的券商。完成后可以继续添加同一家券商的其他账户。",
  account: "请核对券商返回的账户，再选择接收记录的本地账户。",
  bound: "授权已保存。你可以添加其他账户，也可以预览这个账户的第一笔导入。",
};
const errorText = (e) =>
  String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

function AccountProgress({ page, broker, step }) {
  if (page === "welcome" || page === "bound") return null;
  const guide = brokerGuides[broker];
  const visual = guide[step].visual;
  const current = page === "broker" ? 1 : step + (page === "account" ? 3 : 2);
  // Webull tells us whether phone verification is needed only after it checks the credentials.
  let total;
  if (page === "account") total = current;
  else if (page === "guide" && (broker === "ibkr" || visual === "phone")) total = guide.length + 2;

  let location = "Stock Portfolio";
  if (page === "guide" && visual === "portal") {
    location = broker === "ibkr" ? "IBKR 网页" : "Webull 澳洲网页";
  }
  if (page === "guide" && visual === "phone") location = "Webull 手机 App";
  const label = total ? `第 ${current} 步，共 ${total} 步` : `第 ${current} 步`;
  return (
    <div className="ob-studio-progress">
      <div className="ob-drawer-label">
        <b>{label}</b>
        <span>{location}</span>
      </div>
      {total && (
        <progress aria-label="添加此账户的进度" aria-valuetext={label} value={current} max={total} />
      )}
    </div>
  );
}

export function AccountWizard({
  initialPage = "welcome",
  accounts,
  existing,
  theme,
  onTheme,
  onLeave,
  onBound,
  onImport,
}) {
  const [page, setPage] = useState(initialPage),
    [broker, setBroker] = useState("ibkr"),
    [step, setStep] = useState(0);
  const [keys, setKeys] = useState(["", ""]),
    [ticket, setTicket] = useState(""),
    [remote, setRemote] = useState([]),
    [remoteId, setRemoteId] = useState("");
  const [localId, setLocalId] = useState(""),
    [name, setName] = useState(""),
    [currency, setCurrency] = useState("AUD"),
    [added, setAdded] = useState([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    head = useRef(null);
  const chapter = brokerGuides[broker][step],
    ib = broker === "ibkr",
    isKeys = chapter.visual === "credentials",
    phone = chapter.visual === "phone";
  const last = added.at(-1);
  let backLabel = "上一步";
  if (page === "broker") {
    if (last) backLabel = "返回已添加的账户";
    else backLabel = initialPage === "broker" ? "取消添加" : "返回欢迎页";
  }
  const known = [...existing.filter((b) => !added.some((a) => a.id === b.id)), ...added];
  const previewPhone = page === "guide" && broker === "webull" && isKeys;
  const illustrated = page === "guide" && (phone || chapter.images?.length > 0);
  const showAccounts = known.length > 0 && (page === "broker" || page === "bound");
  const hasContext = illustrated || showAccounts;
  useEffect(() => {
    head.current?.focus({ preventScroll: true });
    head.current?.closest(".ob")?.scrollTo(0, 0);
  }, [page, step]);
  async function act(fn) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function pick(b) {
    setBroker(b);
    setKeys(["", ""]);
    setName("");
    setLocalId("");
    setCurrency("AUD");
    setTicket("");
    setRemote([]);
    setStep(0);
    setError("");
    setPage("guide");
  }
  function selectRemote(id, list = remote) {
    const item = list.find((a) => a.accountId === id),
      prior = known.find((a) => a.broker === broker && a.remoteId === id);
    setRemoteId(id);
    setLocalId(prior?.id || "");
    setName(prior?.name || brokerNames[broker] + " · " + (item?.accountNumber || id).slice(-4));
  }
  async function verify() {
    const result =
      phone && ticket
        ? await api.checkAccountSetup({ ticket })
        : await api.beginAccountSetup(
            ib
              ? { broker, queryId: keys[0].trim(), token: keys[1].trim() }
              : { broker, appKey: keys[0].trim(), appSecret: keys[1].trim() },
          );
    setTicket(result.ticket);
    setKeys(["", ""]);
    if (result.accounts.length) {
      setRemote(result.accounts);
      selectRemote(result.accounts[0].accountId, result.accounts);
      setPage("account");
    } else if (!phone) setStep(step + 1);
    else setError("还在等待手机确认。请完成最新一条授权通知，再点「检查授权结果」。");
  }
  async function bind() {
    const saved = await api.bindAccount({ ticket, remoteId, localId, name: name.trim(), currency });
    setAdded((prev) => [...prev.filter((a) => a.id !== saved.id), saved]);
    setPage("bound");
    setTicket("");
    await onBound();
  }
  function back() {
    setError("");
    if (page === "broker") {
      if (!last && initialPage === "broker") return onLeave();
      setPage(last ? "bound" : "welcome");
    } else if (page === "account") {
      setPage("guide");
      if (!phone) setTicket("");
    } else if (step === 0) setPage("broker");
    else {
      setStep(step - 1);
      if (phone) setTicket("");
    }
  }
  const click = (fn) => () => act(fn);
  const leave = click(() => onLeave());
  return (
    <div className="ob theme-D">
      <header className="ob-top">
        <div className="ob-studio-brand">
          <div className="ob-wordmark">
            <Mark />
            <strong>Stock Portfolio</strong>
          </div>
          <span>账户设置</span>
        </div>
        <div className="ob-head-tools">
          <label className="ob-theme-select">
            <select aria-label="向导主题" value={theme} onChange={(e) => onTheme(e.target.value)}>
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <TutorialLauncher broker={broker} page={page} step={step} />
        </div>
      </header>
      <main className={"ob-studio-main" + (page === "welcome" ? " is-welcome" : "")}>
        <section className={"ob-studio-card" + (hasContext || previewPhone ? "" : " single-column")}>
          <AccountProgress page={page} broker={broker} step={step} />
          <div className="ob-studio-copy">
            <h1 ref={head} tabIndex={-1}>
              {page === "guide" ? chapter.title : headings[page]}
            </h1>
            <p className="ob-lead">
              {page === "guide" ? chapter.body : descriptions[page]}
            </p>
          </div>
          {previewPhone && (
            <section className="ob-studio-context ob-phone-preview" aria-labelledby="ob-phone-preview-title">
              <div>
                <h2 id="ob-phone-preview-title">在手机上确认授权</h2>
                <p>发起授权后，如需手机确认，打开 Webull App 的「Menu」，在「Messages」里点「OpenAPI Notice」，再点最新通知的「Check Now」。</p>
              </div>
              <PhoneGuide preview />
            </section>
          )}
          <div className="ob-studio-action">
            {page === "welcome" && (
              <div className="ob-actions">
                <button className="ob-primary" onClick={() => setPage("broker")}>
                  添加账户 <ArrowRight size={16} />
                </button>
                <button disabled={busy} onClick={leave}>
                  暂时跳过
                </button>
              </div>
            )}
            {page === "broker" && (
              <div className="ob-broker-picks">
                {Object.keys(brokerNames).map((b) => (
                  <button key={b} onClick={() => pick(b)}>
                    {b === "ibkr" ? <Layers3 /> : <WalletCards />}
                    <span>
                      <strong>{b === "ibkr" ? "Interactive Brokers" : "Webull Australia"}</strong>
                      <small>{b === "ibkr" ? "Activity Flex" : "OpenAPI"}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
              </div>
            )}
            {page === "guide" && (
              <>
                {isKeys && (
                  <div className="ob-form">
                    {(ib ? ["Flex Query ID", "Flex Token"] : ["App Key", "App Secret"]).map((label, i) => (
                      <div key={label}>
                        <Field label={label}>
                          <input
                            aria-describedby={"source-" + i}
                            disabled={busy}
                            type={i ? "password" : "text"}
                            autoComplete="off"
                            maxLength={4096}
                            value={keys[i]}
                            onChange={(e) =>
                              setKeys((prev) => prev.map((v, n) => (n === i ? e.target.value : v)))
                            }
                          />
                        </Field>
                        <FieldSource
                          field={chapter.fields[i]}
                          id={"source-" + i}
                          label={ib ? ["Query ID", "Current Token"][i] : label}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <StepNotes key={broker + step} chapter={chapter} />
                <div className="ob-actions">
                  <button
                    className="ob-primary"
                    disabled={busy || (isKeys && keys.some((k) => !k.trim()))}
                    onClick={
                      isKeys || phone
                        ? click(verify)
                        : () => {
                            setStep(step + 1);
                            setError("");
                          }
                    }
                  >
                    {busy
                      ? "正在联系券商…"
                      : phone
                        ? "检查授权结果"
                        : isKeys
                          ? ib
                            ? "验证 IBKR 账户"
                            : "发起 Webull 授权"
                          : "下一步"}{" "}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
            {page === "account" && (
              <>
                <div className="ob-form">
                  <Field label="券商返回的账户">
                    <select
                      aria-label="券商返回的账户"
                      value={remoteId}
                      onChange={(e) => selectRemote(e.target.value)}
                    >
                      {remote.map((a) => (
                        <option key={a.accountId} value={a.accountId}>
                          {a.accountNumber || a.accountId} {a.accountType || ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="入账账户">
                    <select
                      aria-label="入账账户"
                      value={localId}
                      onChange={(e) => setLocalId(e.target.value)}
                    >
                      <option value="">创建新的本地账户</option>
                      {accounts
                        .filter(
                          (a) =>
                            a.active &&
                            a.mode === "TRANSACTIONS" &&
                            !known.some(
                              (k) => k.id === a.id && (k.broker !== broker || k.remoteId !== remoteId),
                            ),
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  {!localId && (
                    <>
                      <Field label="本地账户名称">
                        <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
                      </Field>
                      <Field label="基础币种">
                        <select
                          aria-label="基础币种"
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                        >
                          <option>AUD</option>
                          <option>USD</option>
                        </select>
                      </Field>
                    </>
                  )}
                </div>
                <p className="ob-verified">
                  <Check size={17} aria-hidden="true" />
                  已验证 {brokerNames[broker]} ····{" "}
                  {(remote.find((a) => a.accountId === remoteId)?.accountNumber || remoteId).slice(-4)}
                  <span>→</span>
                  <strong>
                    {localId ? accounts.find((a) => a.id === localId)?.name : name.trim() || "待命名账户"}
                  </strong>
                </p>
                <button
                  className="ob-primary"
                  disabled={busy || (!localId && !name.trim())}
                  onClick={click(bind)}
                >
                  绑定此账户
                </button>
              </>
            )}
            {page === "bound" && (
              <div className="ob-actions">
                <button
                  className="ob-primary"
                  disabled={busy}
                  onClick={() => {
                    setPage("broker");
                    setError("");
                  }}
                >
                  继续添加账户
                </button>
                <button disabled={busy} onClick={click(() => onImport(last))}>
                  预览首次导入
                </button>
                <button disabled={busy} onClick={leave}>
                  完成添加
                </button>
              </div>
            )}
            {error && (
              <p className="wizard-error" role="alert">
                {error}
              </p>
            )}
            {["guide", "broker", "account"].includes(page) && (
              <div className="ob-help">
                <button disabled={busy} onClick={click(back)}>
                  <ArrowLeft size={15} /> {backLabel}
                </button>
                {(page !== "broker" || last || initialPage !== "broker") && (
                  <button disabled={busy} onClick={leave}>
                    稍后设置
                  </button>
                )}
              </div>
            )}
          </div>
          {hasContext && (
            <div className="ob-studio-context">
              {illustrated &&
                (phone ? (
                  <PhoneGuide />
                ) : (
                  <Screenshots key={broker + step} images={chapter.images} paired={chapter.paired} />
                ))}
              {showAccounts && (
                <section className="ob-studio-accounts">
                  <h2>已绑定账户</h2>
                  {known.map((a) => (
                    <p key={a.id}>
                      <strong>{a.name}</strong>
                      <small>
                        {brokerNames[a.broker]} ···· {a.suffix}
                        {!a.authorized && " · 需重新授权"}
                      </small>
                    </p>
                  ))}
                </section>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
