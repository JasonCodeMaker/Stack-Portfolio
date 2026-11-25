import React, { useState } from "react";
import { ArrowLeft, Bell, BookOpen, ChevronRight, Grid2X2, MessageCircle, ShieldCheck, Wallet } from "lucide-react";
import { SourceLink } from "./Screenshots";
import sources from "./guide-sources.json";

const steps = ["在 Messages 点 OpenAPI Notice", "在最新的验证通知点 Check Now", "回电脑检查授权结果"];
export function PhoneGuide() {
  const [stage, setStage] = useState(0);
  return (
    <figure className="ob-phone-guide">
      <div className="ob-phone-caption">
        <span>Webull 澳洲 App · 脱敏交互示例</span>
      </div>
      <div className="ob-phone-screen">
        <div className="ob-phone-header">
          {stage > 0 && (
            <button aria-label="返回上一张手机示例" onClick={() => setStage(stage - 1)}>
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
            <strong>在 Webull App 内完成验证</strong>
            <p>如果出现短信验证，输入本人收到的验证码并点 Confirm。</p>
            <button onClick={() => setStage(0)}>重看手机示例</button>
          </div>
        )}
      </div>
      <figcaption>
        <strong>{steps[stage]}</strong>
        <p>
          {stage === 2
            ? "回到 Stock Portfolio，点「检查授权结果」，核对券商返回的账户。"
            : "只确认自己刚在桌面发起的连接。这里的操作仅用于练习。"}{" "}
          <SourceLink url={sources.webullVerification}>澳洲官方说明 ↗</SourceLink>
        </p>
      </figcaption>
    </figure>
  );
}
