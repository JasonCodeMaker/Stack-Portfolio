import { buildIbkrGuide, ibkrGuide } from "./ibkrGuide";
import sources from "./guide-sources.json";
import { tMain } from "../i18n.jsx";
import shot5 from "../../../docs/onboarding/images/broker-guides/webull-developer.png";
import shot6 from "../../../docs/onboarding/images/broker-guides/webull-apply.png";
import shot7 from "../../../docs/onboarding/images/broker-guides/webull-register.png";
import shot8 from "../../../docs/onboarding/images/broker-guides/webull-key.png";
import desktop4light from "../../../docs/onboarding/images/desktop-1.4.7/ibkr-import-light.png";
import desktop4dark from "../../../docs/onboarding/images/desktop-1.4.7/ibkr-import-dark.png";
import desktop5light from "../../../docs/onboarding/images/desktop-1.4.7/webull-import-light.png";
import desktop5dark from "../../../docs/onboarding/images/desktop-1.4.7/webull-import-dark.png";
import desktop6light from "../../../docs/onboarding/images/desktop-1.4.7/ibkr-preview-light.png";
import desktop6dark from "../../../docs/onboarding/images/desktop-1.4.7/ibkr-preview-dark.png";
import desktop7light from "../../../docs/onboarding/images/desktop-1.4.7/webull-preview-light.png";
import desktop7dark from "../../../docs/onboarding/images/desktop-1.4.7/webull-preview-dark.png";

function official(src, caption, source, url) {
  return { src, caption, source, url };
}
export const brokerNames = { ibkr: "IBKR", webull: "Webull AU" };

export function buildBrokerGuides(t = tMain) {
  const webull = (src, caption) => official(src, caption, t("guide.webull.shotSource"), sources.webullApplication);
  return {
    ibkr: buildIbkrGuide(t),
    webull: [
      {
        title: t("guide.wb.s1.title"),
        visual: "portal",
        body: t("guide.wb.s1.body"),
        check: t("guide.wb.s1.check"),
        problem: t("guide.wb.s1.prob"),
        recovery: t("guide.wb.s1.rec"),
        images: [
          webull(shot5, t("guide.wb.s1.cap1")),
          webull(shot6, t("guide.wb.s1.cap2")),
        ],
      },
      {
        title: t("guide.wb.s2.title"),
        visual: "portal",
        body: t("guide.wb.s2.body"),
        check: t("guide.wb.s2.check"),
        problem: t("guide.wb.s2.prob"),
        recovery: t("guide.wb.s2.rec"),
        images: [
          webull(shot7, t("guide.wb.s2.cap1")),
          webull(shot8, t("guide.wb.s2.cap2")),
        ],
      },
      {
        title: t("guide.wb.s3.title"),
        visual: "credentials",
        body: t("guide.wb.s3.body"),
        check: t("guide.wb.s3.check"),
        problem: t("guide.wb.s3.prob"),
        recovery: t("guide.wb.s3.rec"),
        fields: [{ hint: t("guide.wb.f0") }, { hint: t("guide.wb.f1") }],
      },
      {
        title: t("guide.wb.s4.title"),
        visual: "phone",
        body: t("guide.wb.s4.body"),
        check: t("guide.wb.s4.check"),
        problem: t("guide.wb.s4.prob"),
        recovery: t("guide.wb.s4.rec"),
        url: sources.webullVerification,
      },
    ],
  };
}

export const brokerGuides = {
  ibkr: ibkrGuide,
  webull: buildBrokerGuides(tMain).webull,
};

export function accountChapter(broker, t = tMain) {
  return {
    title: t("guide.acct.title"),
    body: t("guide.acct.body", { broker: brokerNames[broker] }),
    check: t("guide.acct.check"),
    recovery: t("guide.acct.recovery"),
    problem: t("guide.acct.problem"),
  };
}

export function importChapter(broker, t = tMain) {
  const ib = broker === "ibkr";
  const desktop = (src, dark, caption, demo = false) => ({
    src,
    dark,
    caption,
    source: t("guide.desktopSource", { book: t(demo ? "guide.desktopBookDemo" : "guide.desktopBookTest") }),
  });
  return {
    title: t("guide.imp.title"),
    body: t("guide.imp.body", { brokerName: ib ? "IBKR" : "Webull AU" }),
    check: t("guide.imp.check"),
    recovery: t("guide.imp.recovery", { fileKind: t(ib ? "guide.imp.ibkrFile" : "guide.imp.webullFile") }),
    images: ib
      ? [
          {
            ...desktop(desktop4light, desktop4dark, t("guide.imp.ibkrCap1")),
            width: 1017,
            height: 257,
            crop: [0, 143, 327, 114],
            target: [15, 198, 208, 36],
          },
          {
            ...desktop(desktop6light, desktop6dark, t("guide.imp.ibkrCap2"), true),
            width: 979,
            height: 180,
            crop: [644, 0, 335, 106],
            target: [794, 5, 102, 37],
            side: "left",
          },
        ]
      : [
          desktop(desktop5light, desktop5dark, t("guide.imp.webullCap1")),
          desktop(desktop7light, desktop7dark, t("guide.imp.webullCap2"), true),
        ],
  };
}
