import sources from "./guide-sources.json";
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
function screen(src, width, height, url = sources.ibkrQuery, source = "IBKR Client Portal Guide") {
  return { src, width, height, url, source, lang: "en" };
}
function focus(screen, label, caption, crop, target, side = "right") {
  return { ...screen, label, caption, crop, target, side };
}
const queryScreen = screen(overview, 1401, 845);
const sectionsScreen = screen(sections, 1200, 1304);
const tradesScreen = screen(trades, 1812, 1070, sources.ibkrTrades, "Trandence · IBKR portal capture");
const deliveryScreen = screen(delivery, 1201, 348);
const tokenScreen = screen(token, 1387, 570, sources.ibkrService);

const queryInfo = focus(
  queryScreen,
  "Query ID",
  "Open the information icon beside your own saved query.",
  [58, 277, 470, 149],
  [88, 337, 32, 32],
);
const tokenValue = focus(
  tokenScreen,
  "Current Token",
  "Copy the value on the Current Token row. The example value is blurred.",
  [0, 206, 866, 156],
  [588, 263, 238, 38],
  "left",
);
const section = (label, y, x = 14) =>
  focus(
    sectionsScreen,
    label,
    "In Sections, open " + label + ".",
    [Math.max(0, x - 15), Math.max(0, y - 47), 535, 148],
    [x + 12, y + 3, Math.max(104, label.length * 9 + 20), 34],
  );

export const ibkrFieldSources = [
  { hint: "复制已保存查询详情中的 Query ID。", photo: queryInfo },
  { hint: "复制 Flex Web Service 中有效的 Current Token。", photo: tokenValue },
];

const portal = {
  visual: "portal",
  lang: "en",
  location: "IBKR Client Portal",
};
export const ibkrGuide = [
  {
    ...portal,
    title: "Create an Activity Flex Query",
    body: "Open Performance & Reports → Flex Queries. If asked, choose the account you want to connect. Select the + on the Activity Flex Query row.",
    images: [
      {
        ...focus(
          queryScreen,
          "Activity Flex Query",
          "Use the + on the Activity Flex Query row.",
          [724, 186, 146, 92],
          [798, 213, 36, 37],
          "left",
        ),
        landmark: [56, 186, 220, 92],
      },
    ],
    check: "The Create Activity Flex Query page opens with a Query Name field.",
    problem: "Can’t find Flex Queries?",
    recovery:
      "Open the main menu, then Reporting → Flex Queries. Look for the Activity Flex Query heading above Trade Confirmation Flex Query.",
    zh: "进入报表菜单，选本次绑定的账户，点 Activity Flex Query 区域的加号。",
  },
  {
    ...portal,
    title: "Name the query and open Trades",
    body: "Enter a memorable Query Name. Under Sections, select Trades to open its field picker.",
    images: [
      section("Trades", 1043, 615),
      focus(
        screen(name, 1194, 208),
        "Query Name",
        "Type a name you will recognise in the query list.",
        [278, 83, 536, 117],
        [409, 121, 359, 57],
        "left",
      ),
    ],
    check: "A panel titled Trades opens with execution options and a field list.",
    problem: "Can’t see Trades?",
    recovery:
      "Scroll through Sections. In the pictured layout, Trades is in the right column below Statement of Funds.",
    zh: "命名查询，在 Sections 列表内找到 Trades；点开后才会出现成交字段。",
  },
  {
    ...portal,
    title: "Select execution details",
    paired: true,
    body: "In Trades, choose Execution. Select all trade fields, then scroll to the bottom of the picker and select Save.",
    images: [
      focus(
        tradesScreen,
        "Execution",
        "Execution has a blue check on its right edge.",
        [875, 143, 925, 252],
        [932, 232, 832, 86],
        "above",
      ),
      focus(
        tradesScreen,
        "Select All",
        "The box beside Select All and the individual field boxes are checked.",
        [24, 492, 617, 254],
        [65, 539, 215, 60],
      ),
    ],
    check: "The field picker closes. Trades is included in the query.",
    problem: "Only seeing totals?",
    recovery:
      "Reopen Trades and select Execution under Options. Confirm that the field list includes Account ID, Currency and trade details before saving.",
    zh: "在 Trades 弹窗选择 Execution，勾选 Select All，然后滚动到底部保存。两张局部图分别显示应有的勾选状态。",
  },
  {
    ...portal,
    title: "Include balances and cash activity",
    body: "For cash, holdings and reconciliation, open the sections below. Select their relevant fields and save each one. Include Account ID and Currency in Account Information. You can continue with Trades alone for trade history.",
    images: [
      section("Account Information", 43),
      section("Cash Transactions", 193),
      section("Cash Report", 143),
      section("Open Positions", 443, 615),
      section("Change in NAV", 343),
    ],
    check: "The saved query includes the sections for the records you intend to import.",
    problem: "Missing cash or positions later?",
    recovery:
      "Edit this query and include Cash Transactions for cash movements, Cash Report for closing cash, Open Positions for holdings and Change in NAV for net asset value. Save the fields in each section.",
    zh: "按需要加入现金流水、期末余额、持仓和净值。图下的英文项目名可以切换到该项目在列表中的位置。",
  },
  {
    ...portal,
    title: "Set the account, format and period",
    body: "Under Delivery Configuration, use Add/Edit Account(s) to select one account. Set Format to XML. Choose a Period that covers the records you want to import.",
    images: [
      focus(
        deliveryScreen,
        "Accounts",
        "Choose the account to bind in this query.",
        [328, 35, 412, 116],
        [412, 73, 189, 55],
        "right",
      ),
      focus(
        deliveryScreen,
        "Format",
        "Select XML from Format.",
        [320, 209, 542, 105],
        [414, 242, 381, 48],
        "above",
      ),
      focus(
        deliveryScreen,
        "Period",
        "Choose the reporting window you need.",
        [320, 252, 542, 96],
        [414, 296, 381, 45],
        "above",
      ),
    ],
    check: "One account is selected and the report format is XML.",
    problem: "Need another account?",
    recovery:
      "Finish this account first. Create a separate single-account query for each additional IBKR account.",
    zh: "选一个账户，把格式设为 XML，并选择覆盖目标交易日期的报表期间。",
  },
  {
    ...portal,
    title: "Review and create the query",
    body: "In General Configuration, set Date Format to yyyyMMdd. Select Continue, review your account, sections and format, then select Create.",
    images: [
      focus(
        screen(general, 1200, 653),
        "Date Format",
        "Set Date Format to yyyyMMdd.",
        [238, 5, 535, 107],
        [368, 35, 345, 43],
        "left",
      ),
      focus(
        screen(general, 1200, 653),
        "Continue",
        "Continue opens the review page.",
        [881, 523, 319, 130],
        [1099, 599, 95, 50],
        "left",
      ),
      focus(
        screen(review, 1200, 1313),
        "Create",
        "Create saves the reviewed query.",
        [880, 1168, 320, 145],
        [1099, 1249, 95, 49],
        "left",
      ),
    ],
    check: "Your named query appears under Activity Flex Query.",
    problem: "Need to change an option?",
    recovery: "Use Back on the review page. Update the setting, review again and select Create.",
    zh: "设置日期格式，检查账户和报表配置，再创建查询。",
  },
  {
    ...portal,
    title: "Copy the Query ID",
    body: "Find your query by name in Activity Flex Query. Open its information icon and copy the Query ID for the desktop form.",
    images: [queryInfo],
    check: "You have the numeric ID for the query you just created.",
    problem: "Can’t see your query?",
    recovery:
      "Check the selected account and the query name. If the query was only reviewed, return to the review screen and select Create.",
    zh: "在刚创建的查询旁打开信息图标，复制 Query ID。",
  },
  {
    ...portal,
    title: "Get your Flex Token",
    body: "Open the gear in Flex Web Service Configuration. If the service is disabled, enable it and save. Copy the active Current Token. Keep an existing valid token when one is available.",
    images: [
      focus(
        screen(enable, 451, 106, sources.ibkrService),
        "Configuration",
        "Open the gear in Flex Web Service Configuration.",
        [0, 0, 451, 106],
        [366, 16, 35, 37],
        "left",
      ),
      focus(
        tokenScreen,
        "Service status",
        "Enable Flex Web Service Status and save if needed.",
        [0, 133, 435, 103],
        [19, 161, 215, 42],
      ),
      tokenValue,
    ],
    check: "You have a Query ID and an active Current Token for this login.",
    problem: "No active token?",
    recovery:
      "Review the service status and activation period. Follow the portal’s token generation flow if necessary. A replacement token can affect other connections using the old one.",
    zh: "点齿轮启用服务并保存，复制有效的 Current Token。有效的旧令牌可以继续使用。",
  },
  {
    visual: "credentials",
    title: "验证 IBKR 账户",
    body: "把刚复制的两项凭据填入下方。验证成功后，可以核对券商返回的账户。",
    check: "验证成功会打开账户选择页。",
    problem: "凭据被拒绝？",
    recovery: "核对查询与令牌属于同一登录身份，检查令牌有效期、IP 限制和查询的账户范围。",
    fields: ibkrFieldSources,
  },
];
