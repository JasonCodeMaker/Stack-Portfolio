import React, { useState } from "react";
import { ArrowLeft, Bell, BookOpen, ChevronRight, Grid2X2, MessageCircle, ShieldCheck, Wallet } from "lucide-react";
import { SourceLink } from "./Screenshots";
import sources from "./guide-sources.json";
import { useI18n } from "../i18n.jsx";

export function PhoneGuide({ preview = false }) {
  const { t } = useI18n();
  const [stage, setStage] = useState(0);
  const steps = [t("ob.phone.step1"), t("ob.phone.step2"), t("ob.phone.step3")];
  return (
    <figure className="ob-phone-guide">
      <div className="ob-phone-caption">
        <span>{t("ob.phone.caption")}</span>
      </div>
      <div className="ob-phone-screen">
        <div className="ob-phone-header">
          {stage > 0 && (
            <button aria-label={t("ob.phone.backAria")} onClick={() => setStage(stage - 1)}>
              <ArrowLeft size={18} />
            </button>
          )}
          {stage === 0 ? "Menu" : "OpenAPI Notice"}
        </div>
        {stage === 0 ? (
          <div className="ob-phone-inbox">
            <h3>Messages</h3>
            <div className="ob-phone-row muted">
              <i>
                <Bell size={17} />
              </i>
              <span>Webull Promotions</span>
            </div>
            <button className="ob-phone-row target" onClick={() => setStage(1)}>
              <i>
                <Wallet size={17} />
              </i>
              <span>
                <b>OpenAPI Notice</b>
                <small>Open API Verification</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <div className="ob-phone-row muted">
              <i>
                <BookOpen size={17} />
              </i>
              <span>Webull Learn</span>
            </div>
            <div className="ob-phone-nav">
              <Grid2X2 size={14} /> Menu
            </div>
          </div>
        ) : stage === 1 ? (
          <div className="ob-phone-thread">
            <span className="ob-message-icon">
              <MessageCircle size={16} />
            </span>
            <div className="ob-phone-bubble">
              <strong>Open API Verification</strong>
              <p>An Open API access request was made for this example account.</p>
              <button onClick={() => setStage(2)}>Check Now</button>
            </div>
          </div>
        ) : (
          <div className="ob-phone-finish">
            <ShieldCheck size={29} />
            <strong>{t("ob.phone.finishTitle")}</strong>
            <p>{t("ob.phone.finishBody")}</p>
            <button onClick={() => setStage(0)}>{t("ob.phone.replay")}</button>
          </div>
        )}
      </div>
      <figcaption>
        <strong>{steps[stage]}</strong>
        <p>
          {stage === 2
            ? preview
              ? t("ob.phone.hintPreview")
              : t("ob.phone.hintVerify")
            : t("ob.phone.hintPractice")}{" "}
          <SourceLink url={sources.webullVerification}>{t("ob.phone.officialLink")}</SourceLink>
        </p>
      </figcaption>
    </figure>
  );
}
