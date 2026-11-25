import { ibkrGuide } from "./ibkrGuide";
import sources from "./guide-sources.json";
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
function desktop(src, dark, caption, demo = false) {
  return {
    src,
    dark,
    caption,
    source: "Stock Portfolio 1.4.7 实拍 · " + (demo ? "内置示例账本" : "独立测试账本"),
  };
}
const webull = (src, caption) => official(src, caption, "Webull 澳洲官方截图", sources.webullApplication);
export const brokerNames = { ibkr: "IBKR", webull: "Webull AU" };
export const brokerGuides = {
  ibkr: ibkrGuide,
  webull: [
    {
      title: "申请 OpenAPI 服务",
      visual: "portal",
      body: "在 Webull 澳洲网站登录有澳洲券商账户的身份。从头像菜单进入 Developer Tool，在 API Management → My Application 提交 OpenAPI 申请。",
      check: "My Application 显示审批通过，或收到开户邮箱的通过通知。",
      problem: "申请仍在审核？",
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
      problem: "找不到 Generate Key？",
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
      problem: "收不到授权通知？",
      recovery: "收不到通知时，核对 App Key 和 App Secret 属于同一个已获批的澳洲应用，再重新发起授权。",
      fields: [{ hint: "复制已获批应用的 App Key。" }, { hint: "填写同一应用生成的 App Secret。" }],
    },
    {
      title: "在手机上确认授权",
      visual: "phone",
      body: "打开 Webull 澳洲 App，点 Menu，在 Messages 找到 OpenAPI Notice（官方文档称 OpenAPI Notifications）。打开最新一条 Open API Verification，确认请求来自你刚才的操作，点 Check Now。依提示在 Webull App 内完成短信验证，再回桌面检查授权。",
      check: "点「检查授权结果」后，在「确认要绑定的账户」页可以选到目标账户。",
      problem: "通知已过期？",
      recovery: "请求超过 5 分钟可过期。在桌面重新发起连接，使用手机上的最新通知。",
      url: sources.webullVerification,
    },
  ],
};
export function accountChapter(broker) {
  return {
    title: "确认账户与名称",
    body:
      "在「券商返回的账户」中核对目标" +
      brokerNames[broker] +
      "账户，再选择已有的本地交易账户，或填写新账户名称和基础币种。点「绑定此账户」后，可以继续添加同一家或另一家券商的账户。",
    check: "「已绑定账户」列出了正确的本地名称和券商账户尾号。",
    recovery: "如果只有「示例」账本，先回到账本切换入口，打开自己的账本。",
    problem: "找不到目标账户？",
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
          {
            ...desktop(desktop4light, desktop4dark, "核对 IBKR 的入账账户。"),
            width: 1017,
            height: 257,
            crop: [0, 143, 327, 114],
            target: [15, 198, 208, 36],
          },
          {
            ...desktop(desktop6light, desktop6dark, "核对预览中的账户和流水后，点「确认保存变更」。", true),
            width: 979,
            height: 180,
            crop: [644, 0, 335, 106],
            target: [794, 5, 102, 37],
            side: "left",
          },
        ]
      : [
          desktop(desktop5light, desktop5dark, "先选 Webull AU 和入账账户。"),
          desktop(desktop7light, desktop7dark, "检查预览中的交易，正确后才确认保存。", true),
        ],
  };
}
