import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronRight, Layers3, WalletCards, BookOpen } from "lucide-react";
import { api, Field } from "../common";
import { Mark } from "../Shell";
import { brokerNames, buildBrokerGuides } from "./brokerGuide";
import { FieldSource, StepNotes } from "./StepNotes";
import { TutorialLauncher } from "./Tutorial";
import { PhoneGuide } from "./PhoneGuide";
import { Screenshots } from "./Screenshots";
import { useI18n } from "../i18n.jsx";
import "./wizard.css";
import "./studio.css";

const errorText = (e) =>
  String(e.message || e).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");

function AccountProgress({ page, broker, step, guides }) {
  const { t } = useI18n();
  if (["welcome", "bound", "custom"].includes(page)) return null;
  const guide = guides[broker];
  const visual = guide[step].visual;
  const current = page === "broker" ? 1 : step + (page === "account" ? 3 : 2);
  // Webull tells us whether phone verification is needed only after it checks the credentials.
  let total;
  if (page === "account") total = current;
  else if (page === "guide" && (broker === "ibkr" || visual === "phone")) total = guide.length + 2;

  let location = t("ob.loc.app");
  if (page === "guide" && visual === "portal") {
    location = broker === "ibkr" ? t("ob.loc.ibkrPortal") : t("ob.loc.webullWeb");
  }
  if (page === "guide" && visual === "phone") location = t("ob.loc.webullPhone");
  const label = total ? t("ob.stepOfTotal", { current, total }) : t("ob.stepOnly", { current });
  return (
    <div className="ob-studio-progress">
      <div className="ob-drawer-label">
        <b>{label}</b>
        <span>{location}</span>
      </div>
      {total && (
        <progress aria-label={t("ob.progressAria")} aria-valuetext={label} value={current} max={total} />
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
  const { t, languagePreference, localeOptions, changeLanguage } = useI18n();
  const guides = buildBrokerGuides(t);
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
    [brokerName, setBrokerName] = useState(""),
    [added, setAdded] = useState([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    head = useRef(null);
  const chapter = guides[broker][step],
    ib = broker === "ibkr",
    isKeys = chapter.visual === "credentials",
    phone = chapter.visual === "phone";
  const last = added.at(-1);
  let backLabel = t("ob.back");
  if (page === "broker") {
    if (last) backLabel = t("ob.backToBound");
    else backLabel = initialPage === "broker" ? t("ob.cancelSetup") : t("ob.backWelcome");
  }
  const known = [...existing, ...accounts.filter((a) => a.custom)].filter((b) => !added.some((a) => a.id === b.id)).concat(added);
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
    else setError(t("ob.waitPhoneError"));
  }
  async function bind() {
    const saved = await api.bindAccount({ ticket, remoteId, localId, name: name.trim(), currency });
    setAdded((prev) => [...prev.filter((a) => a.id !== saved.id), saved]);
    setPage("bound");
    setTicket("");
    await onBound();
  }
  async function addCustom() {
    const id = await api.createCustomAccount({ name, currency, brokerName });
    setAdded((prev) => [...prev, { id, name: name.trim(), custom: true, brokerName: brokerName.trim() }]);
    setPage("bound");
    await onBound();
  }
  function back() {
    setError("");
    if (page === "broker") {
      if (!last && initialPage === "broker") return onLeave();
      setPage(last ? "bound" : "welcome");
    } else if (page === "custom") {
      setPage("broker");
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
          <span>{t("ob.headerSubtitle")}</span>
        </div>
        <div className="ob-head-tools">
          <label className="ob-theme-select">
            <select aria-label={t("ob.themeSelectAria")} value={theme} onChange={(e) => onTheme(e.target.value)}>
              <option value="system">{t("settings.theme.system")}</option>
              <option value="light">{t("settings.theme.light")}</option>
              <option value="dark">{t("settings.theme.dark")}</option>
            </select>
          </label>
          <label className="ob-theme-select">
            <select aria-label={t("lang.label")} value={languagePreference} onChange={(e) => changeLanguage(e.target.value)}>
              {localeOptions.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
          <TutorialLauncher broker={broker} page={page} step={step} />
        </div>
      </header>
      <main className={"ob-studio-main" + (page === "welcome" ? " is-welcome" : "")}>
        <section className={"ob-studio-card" + (hasContext || previewPhone ? "" : " single-column")}>
          <AccountProgress page={page} broker={broker} step={step} guides={guides} />
          <div className="ob-studio-copy">
            <h1 ref={head} tabIndex={-1}>
              {page === "guide" ? chapter.title : t(`ob.heading.${page}`)}
            </h1>
            <p className="ob-lead">
              {page === "guide" ? chapter.body : t(`ob.desc.${page}`)}
            </p>
          </div>
          {previewPhone && (
            <section className="ob-studio-context ob-phone-preview" aria-labelledby="ob-phone-preview-title">
              <div>
                <h2 id="ob-phone-preview-title">{t("ob.phonePreviewTitle")}</h2>
                <p>{t("ob.phonePreviewBody")}</p>
              </div>
              <PhoneGuide preview />
            </section>
          )}
          <div className="ob-studio-action">
            {page === "welcome" && (
              <div className="ob-actions">
                <button className="ob-primary" onClick={() => setPage("broker")}>
                  {t("ob.btn.addAccount")} <ArrowRight size={16} />
                </button>
                <button disabled={busy} onClick={leave}>
                  {t("ob.btn.skipForNow")}
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
                      <small>{t(b === "ibkr" ? "ob.ibkrSub" : "ob.webullSub")}</small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
                <button type="button" onClick={() => {
                  setName("");
                  setBrokerName("");
                  setCurrency("AUD");
                  setError("");
                  setPage("custom");
                }}>
                  <BookOpen aria-hidden="true" />
                  <span><strong>{t("custom.name")}</strong><small>{t("custom.choiceHelp")}</small></span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            )}
            {page === "custom" && (
              <form className="ob-form" onSubmit={(event) => {
                event.preventDefault();
                act(addCustom);
              }}>
                <Field label={t("ob.localName")}>
                  <input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field label={t("custom.brokerName")}>
                  <input maxLength={120} value={brokerName} onChange={(e) => setBrokerName(e.target.value)} />
                </Field>
                <Field label={t("custom.defaultCurrency")}>
                  <select aria-label={t("custom.defaultCurrency")} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option>AUD</option><option>USD</option>
                  </select>
                </Field>
                <button type="submit" className="ob-primary" disabled={busy || !name.trim()}>
                  {t("settings.createAccount")}
                </button>
              </form>
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
                      ? t("ob.checkingBroker")
                      : phone
                        ? t("ob.checkAuthResult")
                        : isKeys
                          ? ib
                            ? t("ob.verifyIbkr")
                            : t("ob.startWebullAuth")
                          : t("ob.next")}{" "}
                    <ArrowRight size={16} />
                  </button>
                </div>
              </>
            )}
            {page === "account" && (
              <>
                <div className="ob-form">
                  <Field label={t("ob.returnedAccount")}>
                    <select
                      aria-label={t("ob.returnedAccount")}
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
                  <Field label={t("ob.targetAccount")}>
                    <select
                      aria-label={t("ob.targetAccount")}
                      value={localId}
                      onChange={(e) => setLocalId(e.target.value)}
                    >
                      <option value="">{t("ob.createNewLocal")}</option>
                      {accounts
                        .filter(
                          (a) =>
                            a.active &&
                            a.mode === "TRANSACTIONS" && !a.custom &&
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
                      <Field label={t("ob.localName")}>
                        <input maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
                      </Field>
                      <Field label={t("ob.baseCurrency")}>
                        <select
                          aria-label={t("ob.baseCurrency")}
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
                  {t("ob.verifiedPrefix", {
                    broker: brokerNames[broker],
                    suffix: (remote.find((a) => a.accountId === remoteId)?.accountNumber || remoteId).slice(-4),
                  })}
                  <span>→</span>
                  <strong>
                    {localId ? accounts.find((a) => a.id === localId)?.name : name.trim() || t("ob.unnamedAccount")}
                  </strong>
                </p>
                <button
                  className="ob-primary"
                  disabled={busy || (!localId && !name.trim())}
                  onClick={click(bind)}
                >
                  {t("ob.bindAccount")}
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
                  {t("ob.addAnotherAccount")}
                </button>
                <button disabled={busy} onClick={click(() => onImport(last))}>
                  {t(last?.custom ? "custom.openLedger" : "ob.previewFirstImport")}
                </button>
                <button disabled={busy} onClick={leave}>
                  {t("ob.finishSetup")}
                </button>
              </div>
            )}
            {error && (
              <p className="wizard-error" role="alert">
                {error}
              </p>
            )}
            {["guide", "broker", "account", "custom"].includes(page) && (
              <div className="ob-help">
                <button disabled={busy} onClick={click(back)}>
                  <ArrowLeft size={15} /> {backLabel}
                </button>
                {(page !== "broker" || last || initialPage !== "broker") && (
                  <button disabled={busy} onClick={leave}>
                    {t("ob.setupLater")}
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
                  <h2>{t("ob.boundAccountsHeading")}</h2>
                  {known.map((a) => (
                    <p key={a.id}>
                      <strong>{a.name}</strong>
                      <small>
                        {a.custom ? a.brokerName || t("custom.name") : brokerNames[a.broker] + " ···· " + a.suffix}
                        {!a.custom && !a.authorized && t("ob.needsReauth")}
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
