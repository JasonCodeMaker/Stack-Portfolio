import sources from "./guide-sources.json";
import shot0 from "../../../docs/onboarding/images/broker-guides/ibkr-overview.jpg";
import shot1 from "../../../docs/onboarding/images/broker-guides/ibkr-sections.jpg";
import shot2 from "../../../docs/onboarding/images/broker-guides/ibkr-delivery.jpg";
import shot3 from "../../../docs/onboarding/images/broker-guides/ibkr-enable.png";
import shot4 from "../../../docs/onboarding/images/broker-guides/ibkr-token.png";
import shot5 from "../../../docs/onboarding/images/broker-guides/webull-developer.png";
import shot6 from "../../../docs/onboarding/images/broker-guides/webull-apply.png";
import shot7 from "../../../docs/onboarding/images/broker-guides/webull-register.png";
import shot8 from "../../../docs/onboarding/images/broker-guides/webull-key.png";
import desktop0light from "../../../docs/onboarding/images/desktop-1.4.7/welcome-light.png";
import desktop0dark from "../../../docs/onboarding/images/desktop-1.4.7/welcome-dark.png";
import confirmLight from "../../../docs/onboarding/images/desktop-1.4.8/confirm-light.png";
import confirmDark from "../../../docs/onboarding/images/desktop-1.4.8/confirm-dark.png";
import ibkrLight from "../../../docs/onboarding/images/desktop-1.4.8/ibkr-light.png";
import ibkrDark from "../../../docs/onboarding/images/desktop-1.4.8/ibkr-dark.png";
import webullLight from "../../../docs/onboarding/images/desktop-1.4.8/webull-light.png";
import webullDark from "../../../docs/onboarding/images/desktop-1.4.8/webull-dark.png";
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
function desktop(src, dark, caption, demo = false) {
  return { src, dark, caption, source: "Stock Portfolio 1.4.7 实拍 · " + (demo ? "内置示例账本" : "独立测试账本") };
}
const query = (src, caption) => official(src, caption, "IBKR 客户门户官方截图", sources.ibkrQuery);
const token = (src, caption) => official(src, caption, "IBKR 客户门户官方截图", sources.ibkrService);
const webull = (src, caption) => official(src, caption, "Webull 澳洲官方截图", sources.webullApplication);
export const brokerNames = {ibkr:"IBKR", webull:"Webull AU"};
export const welcomeShot = desktop(desktop0light, desktop0dark, "点「暂时跳过」后，可迁入旧账本、建立空白账本或试用示例组合。");
function wizardShot(src, dark, caption) {
  return {src, dark, caption, source:"Stock Portfolio 1.4.8 实拍 · 独立测试账本"};
}
export const accountShot = wizardShot(confirmLight, confirmDark, "账户验证通过后，核对券商返回的编号，再选择本地入账账户。");
export const brokerGuides = {
  ibkr: [
    {
      title: "为这个账户创建报表",
      visual: "portal",
      body: "登录 IBKR 客户门户，打开 Performance & Reports → Flex Queries。若出现账户选择器，只选目标账户。在 Activity Flex Query 标题右侧点 ＋。",
      check: "看到新建查询的名称和 Sections 区域。",
      recovery: "菜单布局不同？从左上角 Menu → Reporting → Flex Queries 也可进入。",
      images: [query(shot0, "在 Activity Flex Query 一栏点 ＋。下方的 Trade Confirmation 是另一类查询。")],
    },
    {
      title: "保存查询并取得编号",
      visual: "portal",
      body: "给查询命名。在 Sections 选择 Trades，选择 Executions 和全部成交字段并保存。要导入现金、持仓、净值时，加上 Cash Transactions、Account Information、Cash Report、Open Positions、Change in NAV。在 Delivery Configuration 选单个账户、XML 和所需期间，日期格式选 yyyyMMdd。点 Continue，再点 Create。",
      check: "回到查询列表，打开这份查询的信息，记下 Query ID。",
      recovery: "拉取提示多个账户或没有成交时，检查账户、Trades 字段和报表覆盖的日期。",
      images: [
        query(shot1, "Sections 列出可加入查询的报表项目。"),
        query(shot2, "Delivery Configuration 中确认 Accounts、Format 和 Period。"),
      ],
    },
    {
      title: "取得 Flex Token",
      visual: "portal",
      body: "在 Flex Queries 找到 Flex Web Service Configuration，点齿轮。启用 Flex Web Service 后保存，复制有效的 Current Token。",
      check: "已分别取得 Query ID 和 Current Token。",
      recovery: "已有有效 Token 可直接使用。Generate New Token 会使旧 Token 失效；过期时才需要更换。",
      images: [
        token(shot3, "点 Flex Web Service Configuration 的齿轮。"),
        token(shot4, "在 Current Token 区域复制你自己的凭据。"),
      ],
    },
    {
      title: "把两项凭据填回桌面端",
      visual: "credentials",
      body: "在下方分别填写 Query ID 和 Current Token，点「验证 IBKR 账户」。软件会读取这份 Flex 报表，显示其中的账户编号供你核对。",
      check: "券商返回的账户编号应与刚才选择的账户一致。",
      recovery: "如果同步被拒绝，重新核对 Query ID、Token 有效期和设置的 IP 限制。",
      images: [wizardShot(ibkrLight, ibkrDark, "Query ID 和 Flex Token 分别对应上、下两个输入框。")],
    },
  ],
  webull: [
    {
      title: "申请 OpenAPI 服务",
      visual: "portal",
      body: "在 Webull 澳洲网站登录有澳洲券商账户的身份。从头像菜单进入 Developer Tool，在 API Management → My Application 提交 OpenAPI 申请。",
      check: "My Application 显示审批通过，或收到开户邮箱的通过通知。",
      recovery: "仍在审核时可以先离开。等审批通过后再注册应用。",
      images: [
        webull(shot5, "从右上角头像菜单进入 Developer Tool。"),
        webull(shot6, "在 My Application 中提交个人 OpenAPI 申请。"),
      ],
    },
    {
      title: "注册应用并生成密钥",
      visual: "portal",
      body: "审批通过后，进入 API Management → API Keys Management，注册应用并填写名称。点 Generate Key，按 Webull 页面提示完成验证并保存 App Key 和 App Secret。",
      check: "已经分别保存 App Key、App Secret。",
      recovery: "找不到 Generate Key 时，先查看审批状态，并确认已完成应用注册。",
      images: [
        webull(shot7, "先在 API Keys Management 注册应用。"),
        webull(shot8, "找到已注册的那一行，再点 Generate Key。"),
      ],
    },
    {
      title: "在桌面发起连接",
      visual: "credentials",
      body: "在下方填写刚生成的 App Key 和 App Secret，点「发起 Webull 授权」。按提示打开手机；如果券商已认可此次授权，会直接进入账户选择。",
      check: "如果需要授权，桌面提示去手机确认。已连接并看到券商账户列表时可直接核对账户。",
      recovery: "收不到通知时，核对 App Key 和 App Secret 属于同一个已获批的澳洲应用，再重新发起授权。",
      images: [wizardShot(webullLight, webullDark, "填写两项凭据后，点「发起 Webull 授权」。")],
    },
    {
      title: "在手机上确认授权",
      visual: "phone",
      body: "打开 Webull 澳洲 App，点 Menu，在 Messages 找到 OpenAPI Notice（官方文档称 OpenAPI Notifications）。打开最新一条 Open API Verification，确认请求来自你刚才的操作，点 Check Now。依提示在 Webull App 内完成短信验证，再回桌面检查授权。",
      check: "点「检查授权结果」后，在「确认要绑定的账户」页可以选到目标账户。",
      recovery: "请求超过 5 分钟可过期。在桌面重新发起连接，使用手机上的最新通知。",
      url: sources.webullVerification,
    },
  ],
};
export function accountChapter(broker) {
  return {
    title: "确认账户与名称",
    body: "在「券商返回的账户」中核对目标" + brokerNames[broker] + "账户，再选择已有的本地交易账户，或填写新账户名称和基础币种。点「绑定此账户」后，可以继续添加同一家或另一家券商的账户。",
    check: "「已绑定账户」列出了正确的本地名称和券商账户尾号。",
    recovery: "如果只有「示例」账本，先回到账本切换入口，打开自己的账本。",
    images: [accountShot],
  };
}
export function importChapter(broker) {
  const ib = broker === "ibkr";
  return {
    title: "预览并确认首次导入",
    body:
      "在「导入与对账 → 记录与同步」选择 " +
      (ib ? "IBKR" : "Webull AU") +
      "，展开「入账账户」选刚核对的本地账户，点「同步券商」。在预览中核对一笔熟悉的交易、日期与数量，再点「确认保存变更」。到「交易流水」核对同一账户的记录。",
    check: "已在目标账户找到预期交易，或核实已有流水都已导入。",
    recovery:
      "显示没有新变化时，核对账户、日期范围及已有流水。也可点「导入文件」，选择" +
      (ib ? "该账户的 Flex XML。" : "该账户的成交 CSV。"),
    images: ib
      ? [
          desktop(desktop4light, desktop4dark, "先选 IBKR 和入账账户。"),
          desktop(desktop6light, desktop6dark, "核对变化，正确后才确认保存。", true),
        ]
      : [
          desktop(desktop5light, desktop5dark, "先选 Webull AU 和入账账户。"),
          desktop(desktop7light, desktop7dark, "检查预览中的交易，正确后才确认保存。", true),
        ],
  };
}
