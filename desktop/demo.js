import { EtfCache } from "./allocation/storage/etfCache";
import { storageContext } from "./flows.js";
import { ALLOCATION, preference, putPref, saveEvent, savePrice, transaction } from "./ledger.js";
import { closingDay, shiftDay } from "./marketDays.js";

export const demoDay = "2026-10-30";
export const demoCsv =
  "Order ID,Symbol,Name,Side,Status,Filled Quantity,Average Price,Filled Time,Currency,Commission,Exchange\nWB-DEMO-173,BHP,BHP Group,BUY,Filled,10,44.00,2026-10-27,AUD,0,ASX";
export const demoXml = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="DEMO-IBKR" fromDate="20261027" toDate="20261030"><AccountInformation currency="AUD"/><Trades><Trade accountId="DEMO-IBKR" assetCategory="STK" symbol="AAPL" description="Apple" listingExchange="NASDAQ" dateTime="20261030;100000" buySell="BUY" quantity="1" tradePrice="208" currency="USD" ibCommission="0" ibExecID="DEMO-AAPL-1"/></Trades><CashReport><CashReportCurrency currency="AUD" endingCash="3000"/><CashReportCurrency currency="USD" endingCash="1792"/></CashReport><OpenPositions><OpenPosition symbol="AAPL" position="101" currency="USD" markPrice="208" positionValue="21008" levelOfDetail="SUMMARY"/><OpenPosition symbol="IVV" position="100" currency="USD" markPrice="310" positionValue="31000" levelOfDetail="SUMMARY"/></OpenPositions><ChangeInNAV currency="AUD" endingValue="83700"/></FlexStatement></FlexStatements></FlexQueryResponse>`;
export async function seedDemo(db) {
  if (db.prepare("SELECT COUNT(*) n FROM sp_accounts").get().n) return seedDemoReview(db);
  const start = "2026-09-30";
  transaction(db, () => {
    const add = db.prepare("INSERT INTO sp_accounts VALUES(?,?,?,?,?)");
    add.run("demo-ibkr", "IBKR", "AUD", 1, "TRANSACTIONS");
    add.run("demo-webull", "Webull Australia", "AUD", 1, "TRANSACTIONS");
    const assets = db.prepare("INSERT INTO sp_assets VALUES(?,?,?,?,?,?,?,?)");
    for (const [id, symbol, name, ccy, mic, type, sector, country] of [
      ["aapl", "AAPL", "Apple", "USD", "XNAS", "EQUITY", "Technology", "United States"],
      ["ivv", "IVV", "iShares Core S&P 500 ETF", "USD", "ARCX", "ETF", "", "United States"],
      ["a200", "A200", "Betashares Australia 200 ETF", "AUD", "XASX", "ETF", "", "Australia"],
      ["bhp", "BHP", "BHP Group", "AUD", "XASX", "EQUITY", "Materials", "Australia"],
    ]) {
      assets.run(id, symbol, name, ccy, mic, type, null, JSON.stringify({ sector, country }));
    }
    const anchors = db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)");
    anchors.run("demo-ibkr", start, '{"aapl":"100","ivv":"100"}', '{"AUD":"4000","USD":"2000"}');
    anchors.run("demo-webull", start, '{"a200":"200","bhp":"140"}', '{"AUD":"6040"}');
    const points = [
      [start, 200, 300, 150],
      ["2026-10-06", 202, 302, 150.8],
      ["2026-10-12", 199, 298, 149.6],
      ["2026-10-16", 206, 304, 151.7],
      ["2026-10-22", 203, 306, 150.4],
      ["2026-10-27", 207, 307, 151.3],
      [demoDay, 208, 310, 152.5],
    ];
    for (const [date, aapl, ivv, a200] of points)
      for (const [asset, price] of [
        ["aapl", aapl],
        ["ivv", ivv],
        ["a200", a200],
        ["bhp", 44],
        ["FX:USD/AUD", 1.5],
      ])
        savePrice(db, asset, date, price, "示例结单", 10);
    for (const [a, t] of [
      ["demo-ibkr", "TRANSFER_OUT"],
      ["demo-webull", "TRANSFER_IN"],
    ]) {
      saveEvent(db, {
        id: "demo-transfer-" + a,
        accountId: a,
        activityType: t,
        currency: "AUD",
        amount: "1000",
        date: "2026-10-16",
        group: "demo-paired",
        comment: "两个账户之间划转",
        status: "POSTED",
      });
    }
    db.prepare("INSERT INTO sp_checks VALUES(?,?,?)").run(
      "demo-webull",
      "2026-10-27",
      "Webull 只有成交数据，现金及期间盈亏待月结单核对",
    );
    putPref(db, "app", "demo", "1");
  });
  const cache = new EtfCache(storageContext(db, ALLOCATION));
  for (const [key, holdings] of [
    [
      "ARCX:IVV",
      [
        ["AAPL", "Apple", 0.07, "XNAS", "Technology"],
        ["MSFT", "Microsoft", 0.06, "XNAS", "Technology"],
        ["NVDA", "NVIDIA", 0.065, "XNAS", "Technology"],
      ],
    ],
    [
      "XASX:A200",
      [
        ["BHP", "BHP Group", 0.09, "XASX", "Materials"],
        ["CBA", "Commonwealth Bank", 0.115, "XASX", "Financials"],
      ],
    ],
  ])
    await cache.save({
      schemaVersion: 2,
      etfKey: key,
      provider: "示例成分表",
      asOfDate: demoDay,
      fetchedAt: demoDay + "T05:00:00Z",
      sourceMode: "manual",
      holdings: holdings
        .map(([symbol, name, weight, mic, sector]) => ({
          symbol,
          name,
          weight,
          mic,
          sector,
          country: mic === "XASX" ? "Australia" : "United States",
          underlyingType: "stock",
        }))
        .concat([
          {
            name: "其余成分（示例汇总）",
            weight: 1 - holdings.reduce((v, h) => v + h[2], 0),
            underlyingType: "other",
          },
        ]),
    });
  seedDemoReview(db);
}

function seedDemoReview(db) {
  if (preference(db, "app", "demo") !== "1" || preference(db, "app", "demo-review-v1")) return;
  transaction(db, () => {
    const first = "2026-09-30";
    const insert = db.prepare("INSERT OR IGNORE INTO sp_benchmark_levels VALUES(?,?,?,?)");
    const prices = db.prepare("SELECT day,price FROM sp_prices WHERE asset=? AND source='示例结单' ORDER BY day");
    // Interpolation is confined to this explicitly fictional demonstration book.
    for (const [asset, market] of [["aapl", "US"], ["ivv", "US"], ["a200", "ASX"], ["bhp", "ASX"], ["FX:USD/AUD", "FX"]]) {
      const marks = prices.all(asset);
      for (let i = 1; i < marks.length; i++) {
        const a = marks[i - 1], b = marks[i];
        for (let date = shiftDay(a.day, 1); date < b.day; date = shiftDay(date, 1)) {
          if (closingDay(date, market) !== date) continue;
          const t = (Date.parse(date) - Date.parse(a.day)) / (Date.parse(b.day) - Date.parse(a.day));
          savePrice(db, asset, date, Number(a.price) + (b.price - a.price) * t, "模拟收盘价", 5);
        }
      }
    }
    let i = 0;
    for (let date = first; date <= demoDay; date = shiftDay(date, 1)) {
      if (closingDay(date, "US") !== date) continue;
      insert.run("SP500TR", date, 1000 + i * 1.2 + Math.sin(i / 2) * 7, "示例账本 · 模拟总回报");
      insert.run("XNDX", date, 2000 + i * 3.1 - Math.sin(i / 2) * 25, "示例账本 · 模拟总回报");
      i++;
    }
    putPref(db, "app", "demo-review-v1", "1");
  });
}
