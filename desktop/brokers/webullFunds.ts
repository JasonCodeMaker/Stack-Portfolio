import { createHash } from "node:crypto";
import type { BrokerActivity } from "./types";

export const WEBULL_FUNDS_URL = "https://www.webull.com.au/center/fund-list";
export const WEBULL_FUNDS_ID_PREFIX = "funds:";

interface DepositRow {
  submitted: string;
  method: string;
  amount: string;
  completed: string;
}

const currencies: Record<string, string> = {
  "AU$": "AUD", "A$": "AUD", AUD: "AUD",
  "US$": "USD", USD: "USD", "HK$": "HKD", HKD: "HKD",
};

function portalDate(value: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2}) (AEST|AEDT)$/.exec(value);
  if (!match) throw Error("Webull Funds Records returned an unrecognized date.");
  const [, day, month, year, time, zone] = match;
  const date = [year, month, day].join("-");
  const stamp = date + "T" + time + (zone === "AEDT" ? "+11:00" : "+10:00");
  if (!Number.isFinite(Date.parse(stamp)) || new Date(date).toISOString().slice(0, 10) !== date) {
    throw Error("Webull Funds Records returned an invalid date.");
  }
  return { date, stamp };
}

export function parseWebullFundsDeposits(rows: DepositRow[]): BrokerActivity[] {
  const duplicates = new Set<string>();
  return rows.map((row) => {
    const { stamp: submitted } = portalDate(row.submitted);
    const completed = portalDate(row.completed);
    const amountParts = /^([A-Z]{1,3}\$?)\s+(\d{1,3}(?:,\d{3})+|\d+)\.(\d{2})$/.exec(row.amount);
    const currency = amountParts && currencies[amountParts[1]];
    const amount = amountParts && Number(amountParts[2].replaceAll(",", "") + amountParts[3]);
    if (!currency || !amount || !Number.isSafeInteger(amount) || !row.method ||
        Date.parse(completed.stamp) < Date.parse(submitted)) {
      throw Error("Webull Funds Records returned an invalid completed deposit.");
    }
    const id = createHash("sha256")
      .update(JSON.stringify([submitted, row.method, currency, amount]))
      .digest("hex");
    if (duplicates.has(id)) throw Error("Webull Funds Records returned indistinguishable deposits.");
    duplicates.add(id);
    return {
      broker: "webull",
      brokerRecordId: WEBULL_FUNDS_ID_PREFIX + id,
      activityType: "DEPOSIT",
      // The ledger groups cash flows by their Australian calendar day.
      date: completed.date + "T12:00:00Z",
      symbol: "",
      amount: amount / 100,
      currency,
      metadata: { webullFunds: { submitted, completed: completed.stamp, method: row.method } },
    };
  });
}

// Runs in the sandboxed Webull window.
export function webullFundsPageStatus() {
  const text = document.body?.innerText || "";
  if (/please enter (?:the )?trading password|请输入交易密码|請輸入交易密碼/i.test(text)) {
    return "verification";
  }
  return Array.from(document.querySelectorAll("h2")).some((heading) => heading.textContent?.trim() === "Funds Records")
    ? "ready"
    : "waiting";
}

// Read only the deposit list and its details.
export async function readWebullFundsPage(): Promise<DepositRow[]> {
  function waitFor<T>(read: () => T | undefined): Promise<T> {
    return new Promise((resolve, reject) => {
      const end = Date.now() + 5_000;
      function readAgain() {
        const value = read();
        if (value !== undefined) resolve(value);
        else if (Date.now() < end) setTimeout(readAgain, 50);
        else reject(Error("Webull Funds Records changed or did not load."));
      }
      readAgain();
    });
  }

  function exactLeaf(root: ParentNode, selector: string, label: string) {
    return Array.from(root.querySelectorAll<HTMLElement>(selector))
      .find((node) => !node.children.length && node.textContent?.trim() === label);
  }

  function currentList() {
    const root = exactLeaf(document, "h2", "Funds Records")?.parentElement?.parentElement;
    if (!root || exactLeaf(root, ".tab-tabView.active", "Deposit") === undefined) return;
    const header = Array.from(root.querySelectorAll(".table-header-cell-name"), (cell) => cell.textContent?.trim());
    if (header.join("|") !== "Submission Date/Time|Transfer Method|Deposit Currency|Status") return;
    if (root.querySelector(".table-body > .table-row") ||
        /\b(?:no (?:funds? )?(?:data|records|transactions|history|results)|nothing to display)\b/i.test(root.innerText)) return root;
  }

  const items = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(".table-body > .table-row"));
  let list = await waitFor(currentList);
  if (list.querySelector(".pagination, [class*='pagination'], [aria-label='Next page']")) {
    throw Error("Webull Funds Records requires unrecognized pagination.");
  }
  const rows = items(list).map((row) =>
    Array.from(row.querySelectorAll<HTMLElement>(":scope > .table-cell"), (cell) => cell.innerText.trim()));
  const result: DepositRow[] = [];
  for (const [index, row] of rows.entries()) {
    const [submitted, method, amount, status] = row;
    if (!submitted || !method || !amount || !status) throw Error("Webull Funds Records has an unrecognized row.");
    if (status !== "Completed") continue;

    const item = items(list)[index];
    if (!item || Array.from(item.children, (cell) => (cell as HTMLElement).innerText.trim()).join("|") !== row.join("|")) {
      throw Error("Webull Funds Records changed while reading deposits.");
    }
    item.click();
    function detailValue(label: string) {
      return exactLeaf(document, "p", label)?.parentElement?.nextElementSibling?.textContent?.trim();
    }
    const normalizeAmount = (text: string | undefined) => text?.replace(/[\s,]+/g, "");
    const completed = await waitFor(() => {
      if (detailValue("Status") === "Completed" && detailValue("Transfer Method") === method &&
          normalizeAmount(detailValue("Amount")) === normalizeAmount(amount)) {
        return detailValue("Updated By") || undefined;
      }
    });
    result.push({ submitted, method, amount, completed });
    if (index < rows.length - 1) {
      const detail = exactLeaf(document, "span", "Deposit Details");
      const back = detail?.parentElement?.firstElementChild;
      if (!(back instanceof HTMLElement) || back.textContent?.trim() !== "Deposit") {
        throw Error("Webull Funds Records has an unrecognized detail view.");
      }
      back.click();
      list = await waitFor(currentList);
    }
  }
  return result;
}
