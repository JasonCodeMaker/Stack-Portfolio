import React, { useEffect, useState } from "react";
import { api } from "./common";
import { useI18n } from "./i18n.jsx";
import "./macroAnalysis.css";

export function MacroAnalysis() {
  const { locale, t } = useI18n();
  const [sentiment, setSentiment] = useState(null);
  const [refreshing, setRefreshing] = useState(true);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      if (request === 0) {
        const cached = await api.macroMarket().catch(() => null);
        if (!active) return;
        setSentiment(cached?.sentiment ?? null);
      }
      try {
        const snapshot = await api.refreshMacroMarket();
        if (active) setSentiment(snapshot.sentiment);
      } catch {
        if (active) setSentiment((reading) => reading && { ...reading, status: "stale" });
      } finally {
        if (active) setRefreshing(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [request]);

  const hasScore = Number.isFinite(sentiment?.score);
  const score = hasScore && new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(sentiment.score);
  const time = hasScore && new Intl.DateTimeFormat(locale, {
    timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(sentiment.updatedAt));

  return (
    <section className="card macro-sentiment" aria-labelledby="macro-sentiment-heading">
      <header className="card-head">
        <h2 id="macro-sentiment-heading">{t("macro.sentiment.title")}</h2>
        <button type="button" className="btn" disabled={refreshing} onClick={() => {
          setRefreshing(true);
          setRequest((value) => value + 1);
        }}>
          {t(refreshing ? "macro.sentiment.refreshing" : "macro.sentiment.refresh")}
        </button>
      </header>
      <div className="macro-sentiment-body" role="status">
        <div className="macro-sentiment-figure" aria-hidden="true">
          <div className="macro-sentiment-gauge" data-available={hasScore}>
            <span className="macro-sentiment-arc" />
            {hasScore && (
              <>
                <span className="macro-sentiment-needle" style={{ "--needle-angle": (sentiment.score * 1.8 - 90) + "deg" }} />
                <span className="macro-sentiment-hub" />
              </>
            )}
          </div>
          <div className="macro-sentiment-scale"><span>0</span><span>50</span><span>100</span></div>
        </div>
        <div className="macro-sentiment-reading">
          {hasScore ? (
            <>
              <p className="macro-sentiment-score">{score}<span> / 100</span></p>
              <p className="macro-sentiment-rating">{t("macro.sentiment.rating." + sentiment.rating)}</p>
              <time dateTime={sentiment.updatedAt}>{t("macro.sentiment.updatedAt", { time })}</time>
              {sentiment.status === "stale" && <p className="macro-sentiment-stale">{t("macro.sentiment.stale")}</p>}
            </>
          ) : (
            <p className="macro-sentiment-rating">{t(refreshing ? "macro.sentiment.refreshing" : "macro.sentiment.unavailable")}</p>
          )}
          <p className="macro-sentiment-source">{t("macro.sentiment.source", { name: sentiment?.source ?? "Fear & Greed Flow" })}</p>
        </div>
      </div>
    </section>
  );
}
