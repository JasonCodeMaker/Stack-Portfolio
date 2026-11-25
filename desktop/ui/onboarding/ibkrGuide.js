import sources from "./guide-sources.json";
import { tMain } from "../i18n.jsx";
import overview from "../../../docs/onboarding/images/broker-guides/ibkr-overview.jpg";
import name from "../../../docs/onboarding/images/broker-guides/ibkr-name.jpg";
import sections from "../../../docs/onboarding/images/broker-guides/ibkr-sections.jpg";
import trades from "../../../docs/onboarding/images/broker-guides/ibkr-trades.png";
import delivery from "../../../docs/onboarding/images/broker-guides/ibkr-delivery.jpg";
import general from "../../../docs/onboarding/images/broker-guides/ibkr-general.jpg";
import review from "../../../docs/onboarding/images/broker-guides/ibkr-review.jpg";
import enable from "../../../docs/onboarding/images/broker-guides/ibkr-enable.png";
import token from "../../../docs/onboarding/images/broker-guides/ibkr-token.png";

// All bounds are in source-image pixels. The same marks are used in the detail and the overview.
function focus(screen, label, caption, crop, target, side = "right") {
  return { ...screen, label, caption, crop, target, side };
}

export function buildIbkrGuide(t = tMain) {
  const portal = t("guide.ibkr.portalSource");
  const screen = (src, width, height, url = sources.ibkrQuery, source = portal) => ({
    src,
    width,
    height,
    url,
    source,
  });
  const queryScreen = screen(overview, 1401, 845);
  const sectionsScreen = screen(sections, 1200, 1304);
  const tradesScreen = screen(trades, 1812, 1070, sources.ibkrTrades, t("guide.ibkr.tradesSource"));
  const deliveryScreen = screen(delivery, 1201, 348);
  const tokenScreen = screen(token, 1387, 570, sources.ibkrService);

  const queryInfo = focus(
    queryScreen,
    "Query ID",
    t("guide.ibkr.queryIdCap"),
    [58, 277, 470, 149],
    [88, 337, 32, 32],
  );
  const tokenValue = focus(
    tokenScreen,
    "Current Token",
    t("guide.ibkr.tokenCap"),
    [0, 206, 866, 156],
    [588, 263, 238, 38],
    "left",
  );
  const section = (label, y, x = 14) =>
    focus(
      sectionsScreen,
      label,
      t("guide.ibkr.sectionCap", { label }),
      [Math.max(0, x - 15), Math.max(0, y - 47), 535, 148],
      [x + 12, y + 3, Math.max(104, label.length * 9 + 20), 34],
    );

  const fields = [
    { hint: t("guide.ibkr.field0Hint"), photo: queryInfo },
    { hint: t("guide.ibkr.field1Hint"), photo: tokenValue },
  ];

  return [
    {
      visual: "portal",
      title: t("guide.ibkr.s1.title"),
      body: t("guide.ibkr.s1.body"),
      images: [
        {
          ...focus(
            queryScreen,
            "Activity Flex Query",
            t("guide.ibkr.s1.imgCap"),
            [724, 186, 146, 92],
            [798, 213, 36, 37],
            "left",
          ),
          landmark: [56, 186, 220, 92],
        },
      ],
      check: t("guide.ibkr.s1.check"),
      problem: t("guide.ibkr.s1.prob"),
      recovery: t("guide.ibkr.s1.rec"),
    },
    {
      visual: "portal",
      title: t("guide.ibkr.s2.title"),
      body: t("guide.ibkr.s2.body"),
      images: [
        section("Trades", 1043, 615),
        focus(
          screen(name, 1194, 208),
          "Query Name",
          t("guide.ibkr.s2.imgCap"),
          [278, 83, 536, 117],
          [409, 121, 359, 57],
          "left",
        ),
      ],
      check: t("guide.ibkr.s2.check"),
      problem: t("guide.ibkr.s2.prob"),
      recovery: t("guide.ibkr.s2.rec"),
    },
    {
      visual: "portal",
      title: t("guide.ibkr.s3.title"),
      paired: true,
      body: t("guide.ibkr.s3.body"),
      images: [
        focus(
          tradesScreen,
          "Execution",
          t("guide.ibkr.s3.cap1"),
          [875, 143, 925, 252],
          [932, 232, 832, 86],
          "above",
        ),
        focus(
          tradesScreen,
          "Select All",
          t("guide.ibkr.s3.cap2"),
          [24, 492, 617, 254],
          [65, 539, 215, 60],
        ),
      ],
      check: t("guide.ibkr.s3.check"),
      problem: t("guide.ibkr.s3.prob"),
      recovery: t("guide.ibkr.s3.rec"),
    },
    {
      visual: "portal",
      title: t("guide.ibkr.s4.title"),
      body: t("guide.ibkr.s4.body"),
      images: [
        section("Account Information", 43),
        section("Cash Transactions", 193),
        section("Cash Report", 143),
        section("Open Positions", 443, 615),
        section("Change in NAV", 343),
      ],
      check: t("guide.ibkr.s4.check"),
      problem: t("guide.ibkr.s4.prob"),
      recovery: t("guide.ibkr.s4.rec"),
    },
    {
      visual: "portal",
      title: t("guide.ibkr.s5.title"),
      body: t("guide.ibkr.s5.body"),
      images: [
        focus(
          deliveryScreen,
          "Accounts",
          t("guide.ibkr.s5.cap1"),
          [328, 35, 412, 116],
          [412, 73, 189, 55],
          "right",
        ),
        focus(
          deliveryScreen,
          "Format",
          t("guide.ibkr.s5.cap2"),
          [320, 209, 542, 105],
          [414, 242, 381, 48],
          "above",
        ),
        focus(
          deliveryScreen,
          "Period",
          t("guide.ibkr.s5.cap3"),
          [320, 252, 542, 96],
          [414, 296, 381, 45],
          "above",
        ),
      ],
      check: t("guide.ibkr.s5.check"),
      problem: t("guide.ibkr.s5.prob"),
      recovery: t("guide.ibkr.s5.rec"),
    },
    {
      visual: "portal",
      title: t("guide.ibkr.s6.title"),
      body: t("guide.ibkr.s6.body"),
      images: [
        focus(
          screen(general, 1200, 653),
          "Date Format",
          t("guide.ibkr.s6.cap1"),
          [238, 5, 535, 107],
          [368, 35, 345, 43],
          "left",
        ),
        focus(
          screen(general, 1200, 653),
          "Continue",
          t("guide.ibkr.s6.cap2"),
          [881, 523, 319, 130],
          [1099, 599, 95, 50],
          "left",
        ),
        focus(
          screen(review, 1200, 1313),
          "Create",
          t("guide.ibkr.s6.cap3"),
          [880, 1168, 320, 145],
          [1099, 1249, 95, 49],
          "left",
        ),
      ],
      check: t("guide.ibkr.s6.check"),
      problem: t("guide.ibkr.s6.prob"),
      recovery: t("guide.ibkr.s6.rec"),
    },
    {
      visual: "portal",
      title: t("guide.ibkr.s7.title"),
      body: t("guide.ibkr.s7.body"),
      images: [queryInfo],
      check: t("guide.ibkr.s7.check"),
      problem: t("guide.ibkr.s7.prob"),
      recovery: t("guide.ibkr.s7.rec"),
    },
    {
      visual: "portal",
      title: t("guide.ibkr.s8.title"),
      body: t("guide.ibkr.s8.body"),
      images: [
        focus(
          screen(enable, 451, 106, sources.ibkrService),
          "Flex Web Service Configuration",
          t("guide.ibkr.s8.cap1"),
          [0, 0, 451, 106],
          [366, 16, 35, 37],
          "left",
        ),
        focus(
          tokenScreen,
          "Flex Web Service Status",
          t("guide.ibkr.s8.cap2"),
          [0, 133, 435, 103],
          [19, 161, 215, 42],
        ),
        tokenValue,
      ],
      check: t("guide.ibkr.s8.check"),
      problem: t("guide.ibkr.s8.prob"),
      recovery: t("guide.ibkr.s8.rec"),
    },
    {
      visual: "credentials",
      title: t("guide.ibkr.s9.title"),
      body: t("guide.ibkr.s9.body"),
      check: t("guide.ibkr.s9.check"),
      problem: t("guide.ibkr.s9.prob"),
      recovery: t("guide.ibkr.s9.rec"),
      fields,
    },
  ];
}

export const ibkrGuide = buildIbkrGuide(tMain);
export const ibkrFieldSources = ibkrGuide[8].fields;
