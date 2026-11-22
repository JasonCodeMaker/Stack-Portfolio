// §6 figures, seeded before the isolated example book is opened.
async function seedAcceptanceBook(electron) {
  await electron.evaluate(({ app, safeStorage }) => {
    const fs = process.getBuiltinModule("node:fs");
    const path = process.getBuiltinModule("node:path");
    const { randomBytes } = process.getBuiltinModule("node:crypto");
    const fromApp = process.getBuiltinModule("node:module").createRequire(path.join(app.getAppPath(), "package.json"));
    const { createBook, putPref, saveEvent, savePrice } = fromApp("./out/ledger.cjs");
    const directory = app.getPath("userData");
    const key = randomBytes(32).toString("hex");
    fs.writeFileSync(path.join(directory, "ledger-key.v1"), safeStorage.encryptString(key), { flag: "wx" });
    const db = createBook(path.join(directory, "sample.sqlite"), Buffer.from("raw:" + key));
    const opening = "2024-12-31";
    try {
      const account = db.prepare("INSERT INTO sp_accounts VALUES(?,?,?,1,'TRANSACTIONS')");
      account.run("demo-ibkr", "IBKR", "AUD");
      account.run("demo-webull", "Webull Australia", "AUD");
      const asset = db.prepare("INSERT INTO sp_assets VALUES(?,?,?,?,?,?,NULL,?)");
      // Small positions keep the filtered table tall enough to test restoring a scrolled row.
      const filler = Array.from({ length: 14 }, (_, i) => "fill" + String(i + 1).padStart(2, "0"));
      for (const [id, symbol, name, currency, mic, kind, sector, country] of [
        ["aapl", "AAPL", "Apple", "USD", "XNAS", "EQUITY", "Technology", "United States"],
        ["ivv", "IVV", "iShares Core S&P 500 ETF", "USD", "ARCX", "ETF", "", "United States"],
        ["bhp", "BHP", "BHP Group", "AUD", "XASX", "EQUITY", "Materials", "Australia"],
        ["mid", "MID", "Middle-cap holding", "AUD", "XASX", "EQUITY", "Industrials", "Australia"],
        ["mock", "MOCK", "Sample stock with no cost", "AUD", "XASX", "EQUITY", "Technology", "Australia"],
        ["abc", "ABC", "ABC Limited", "AUD", "XASX", "EQUITY", "Industrials", "Australia"],
        ...filler.map((id) => [id, id.toUpperCase(), "Sample stock " + id, "AUD", "XASX", "EQUITY", "Technology", "Australia"]),
      ]) {
        asset.run(id, symbol, name, currency, mic, kind, JSON.stringify({ sector, country }));
      }
      const anchor = db.prepare("INSERT INTO sp_anchors VALUES(?,?,?,?)");
      anchor.run("demo-ibkr", opening, '{"aapl":"8","ivv":"100"}', '{"AUD":"11827"}');
      const webull = { aapl: "2", bhp: String(315 - filler.length), mid: "35", mock: "10" };
      for (const id of filler) webull[id] = "1";
      anchor.run("demo-webull", opening, JSON.stringify(webull), '{"AUD":"7994"}');
      for (const [date, apple, fund, sold] of [
        [opening, 280, 316, null],
        ["2025-11-28", 310, 319.2, 100],
        ["2025-12-01", 308, 319.2, 100],
        ["2025-12-02", 302, 319, 110],
        ["2025-12-05", 258, 318, null],
        ["2025-12-31", 320, 320, null],
      ]) {
        for (const [id, price] of Object.entries({ aapl: apple, ivv: fund, bhp: 100, mid: 100, mock: 100, abc: sold, "FX:USD/AUD": 1.25 })) {
          if (price != null) savePrice(db, id, date, price, "fixture close");
        }
        for (const id of filler) savePrice(db, id, date, 100, "fixture close");
        const levels = db.prepare("INSERT INTO sp_benchmark_levels VALUES(?,?,?,?)");
        levels.run("SP500TR", date, 1000 * fund / 316, "fixture index");
        levels.run("XNDX", date, 1000 * apple / 280, "fixture index");
      }
      let nextId = 0;
      const activity = (date, activityType, amount, details) => saveEvent(db, {
        id: "acceptance-" + ++nextId,
        accountId: "demo-ibkr",
        date,
        activityType,
        currency: "AUD",
        amount,
        status: "POSTED",
        ...details,
      });
      activity("2025-02-04", "DEPOSIT", "100");
      activity("2025-11-03", "BUY", null, { assetId: "abc", quantity: "1", unitPrice: "40" });
      savePrice(db, "abc", "2025-11-03", "40", "fixture close");
      activity("2025-12-02", "SELL", null, { assetId: "abc", quantity: "1", unitPrice: "110" });
      activity("2025-12-05", "DIVIDEND", "6.4", { assetId: "ivv", currency: "USD" });
      activity("2025-12-05", "FEE", "1.6", { assetId: "ivv", currency: "USD" });
      activity("2025-12-05", "INTEREST", "3");
      for (const flag of ["demo", "demo-costs-v1", "demo-review-v1"]) putPref(db, "app", flag, "1");
    } finally {
      db.close();
    }
  });
}

module.exports = { seedAcceptanceBook };
