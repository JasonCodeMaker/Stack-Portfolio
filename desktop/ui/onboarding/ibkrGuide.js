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
function screen(src, width, height, url = sources.ibkrQuery, source = "IBKR 客户门户官方指南") {
  return { src, width, height, url, source };
}
function focus(screen, label, caption, crop, target, side = "right") {
  return { ...screen, label, caption, crop, target, side };
}
const queryScreen = screen(overview, 1401, 845);
const sectionsScreen = screen(sections, 1200, 1304);
const tradesScreen = screen(trades, 1812, 1070, sources.ibkrTrades, "Trandence · IBKR 网页实拍");
const deliveryScreen = screen(delivery, 1201, 348);
const tokenScreen = screen(token, 1387, 570, sources.ibkrService);

const queryInfo = focus(
  queryScreen,
  "Query ID",
  "找到自己的报表，点同一行的信息图标查看「Query ID」。",
  [58, 277, 470, 149],
  [88, 337, 32, 32],
);
const tokenValue = focus(
  tokenScreen,
  "Current Token",
  "复制「Current Token」这一行的值。图中的令牌已遮挡。",
  [0, 206, 866, 156],
  [588, 263, 238, 38],
  "left",
);
const section = (label, y, x = 14) =>
  focus(
    sectionsScreen,
    label,
    "在「Sections」中点「" + label + "」。",
    [Math.max(0, x - 15), Math.max(0, y - 47), 535, 148],
    [x + 12, y + 3, Math.max(104, label.length * 9 + 20), 34],
  );

export const ibkrFieldSources = [
  { hint: "复制已保存查询详情中的 Query ID。", photo: queryInfo },
  { hint: "复制 Flex Web Service 中有效的 Current Token。", photo: tokenValue },
];

export const ibkrGuide = [
  {
    visual: "portal",
    title: "创建活动报表",
    body: "登录 IBKR 客户门户，打开「Performance & Reports → Flex Queries」。如果弹出账户列表，选本次要绑定的账户。在「Activity Flex Query」这一行点右侧的「+」。",
    images: [
      {
        ...focus(
          queryScreen,
          "Activity Flex Query",
          "点「Activity Flex Query」这一行右侧的「+」。",
          [724, 186, 146, 92],
          [798, 213, 36, 37],
          "left",
        ),
        landmark: [56, 186, 220, 92],
      },
    ],
    check: "新页面出现「Query Name」输入框。",
    problem: "找不到「Flex Queries」？",
    recovery: "打开左上角「Menu → Reporting → Flex Queries」。在「Trade Confirmation Flex Query」上方找到「Activity Flex Query」。",
  },
  {
    visual: "portal",
    title: "给报表命名并打开成交设置",
    body: "在「Query Name」输入容易认出的名称。在「Sections」找到并点开「Trades」。",
    images: [
      section("Trades", 1043, 615),
      focus(
        screen(name, 1194, 208),
        "Query Name",
        "在「Query Name」输入稍后能在列表中认出的名称。",
        [278, 83, 536, 117],
        [409, 121, 359, 57],
        "left",
      ),
    ],
    check: "出现「Trades」弹窗，里面有成交选项和字段列表。",
    problem: "找不到「Trades」？",
    recovery: "向下滚动「Sections」。在图示布局中，「Trades」位于右栏的「Statement of Funds」下方。",
  },
  {
    visual: "portal",
    title: "选择逐笔成交字段",
    paired: true,
    body: "在「Trades」弹窗的「Options」选择「Execution」。勾选「Select All」，再滚动到弹窗底部点「Save」。",
    images: [
      focus(
        tradesScreen,
        "Execution",
        "选中后，「Execution」右侧会出现蓝色勾。",
        [875, 143, 925, 252],
        [932, 232, 832, 86],
        "above",
      ),
      focus(
        tradesScreen,
        "Select All",
        "确认「Select All」和下方各字段的方框都已勾选。",
        [24, 492, 617, 254],
        [65, 539, 215, 60],
      ),
    ],
    check: "弹窗关闭，刚选的成交字段已加入报表。",
    problem: "只看到汇总数据？",
    recovery: "重新打开「Trades」，检查「Options」是否选中「Execution」。在字段列表中核对「Account ID」「Currency」和成交明细字段，再点「Save」。",
  },
  {
    visual: "portal",
    title: "选择要导入的现金和持仓数据",
    body: "在「Sections」按需要添加报表项目。打开「Account Information」勾选「Account ID」和「Currency」。如需导入现金流水、期末现金、持仓或净值，依次打开对应项目，选择字段，每项都点「Save」。",
    images: [
      section("Account Information", 43),
      section("Cash Transactions", 193),
      section("Cash Report", 143),
      section("Open Positions", 443, 615),
      section("Change in NAV", 343),
    ],
    check: "回到「Sections」后，可以核对已选的报表项目。",
    problem: "应该选哪些报表项目？",
    recovery: "现金流水选「Cash Transactions」，期末现金选「Cash Report」，持仓选「Open Positions」，净值变动选「Change in NAV」。可以点图上的英文项目名查看对应位置。",
  },
  {
    visual: "portal",
    title: "设置账户、格式和报表期间",
    body: "在「Delivery Configuration」点「Add/Edit Account(s)」，只选这次要绑定的账户。把「Format」设为「XML」，在「Period」选择覆盖目标交易日期的期间。",
    images: [
      focus(
        deliveryScreen,
        "Accounts",
        "点「Add/Edit Account(s)」，选择本次要绑定的账户。",
        [328, 35, 412, 116],
        [412, 73, 189, 55],
        "right",
      ),
      focus(
        deliveryScreen,
        "Format",
        "在「Format」选择「XML」。",
        [320, 209, 542, 105],
        [414, 242, 381, 48],
        "above",
      ),
      focus(
        deliveryScreen,
        "Period",
        "在「Period」选择覆盖目标日期的期间。",
        [320, 252, 542, 96],
        [414, 296, 381, 45],
        "above",
      ),
    ],
    check: "「Accounts」只列出目标账户，「Format」显示「XML」。",
    problem: "还需要绑定其他账户？",
    recovery: "先完成这个账户的绑定。之后可点「继续添加账户」，为另一个 IBKR 账户单独创建报表。",
  },
  {
    visual: "portal",
    title: "检查并创建报表",
    body: "在「General Configuration」把「Date Format」设为「yyyyMMdd」。点「Continue」，核对账户、报表项目和格式，确认后点「Create」。",
    images: [
      focus(
        screen(general, 1200, 653),
        "Date Format",
        "将「Date Format」设为「yyyyMMdd」。",
        [238, 5, 535, 107],
        [368, 35, 345, 43],
        "left",
      ),
      focus(
        screen(general, 1200, 653),
        "Continue",
        "点「Continue」进入核对页。",
        [881, 523, 319, 130],
        [1099, 599, 95, 50],
        "left",
      ),
      focus(
        screen(review, 1200, 1313),
        "Create",
        "确认信息正确后，点「Create」保存报表。",
        [880, 1168, 320, 145],
        [1099, 1249, 95, 49],
        "left",
      ),
    ],
    check: "返回「Activity Flex Query」列表后，可以找到刚才命名的报表。",
    problem: "发现有选项需要修改？",
    recovery: "在核对页点「Back」返回，修改后再点「Continue」核对，最后点「Create」。",
  },
  {
    visual: "portal",
    title: "复制查询编号",
    body: "在「Activity Flex Query」列表中找到刚才命名的报表。点这一行的信息图标，复制「Query ID」，稍后填回桌面端。",
    images: [queryInfo],
    check: "详情中显示这份报表的「Query ID」。",
    problem: "列表里找不到刚建的报表？",
    recovery: "核对当前账户和报表名称。如果刚才只到了核对页，返回并点「Create」完成创建。",
  },
  {
    visual: "portal",
    title: "取得访问令牌",
    body: "点「Flex Web Service Configuration」右侧的齿轮。如果服务尚未启用，启用后点「Save」。复制有效的「Current Token」。已有有效令牌时可以直接使用。",
    images: [
      focus(
        screen(enable, 451, 106, sources.ibkrService),
        "Flex Web Service Configuration",
        "点「Flex Web Service Configuration」右侧的齿轮。",
        [0, 0, 451, 106],
        [366, 16, 35, 37],
        "left",
      ),
      focus(
        tokenScreen,
        "Flex Web Service Status",
        "检查「Flex Web Service Status」。如需启用，勾选后保存。",
        [0, 133, 435, 103],
        [19, 161, 215, 42],
      ),
      tokenValue,
    ],
    check: "现在手里有同一登录身份下的「Query ID」和有效的「Current Token」。",
    problem: "找不到有效令牌？",
    recovery: "核对服务是否已启用、令牌是否仍在有效期内。需要时按网页提示生成令牌。替换旧令牌会影响使用它的其他连接。",
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
