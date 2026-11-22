# Portfolio Management

This context describes how account activity and tradable positions become portfolio valuations, allocation, and economic exposure.

## Language

**Security**:
A tradable instrument or share class identified by its ticker, such as GOOGL Class A or GOOG Class C.
_Avoid_: Company, issuer

**Security holding**:
The units of a security held directly in an investment account, such as shares of a stock or units of an ETF. Cash is a separate account balance and contributes to total account value alongside security holdings.
_Avoid_: Company exposure

**Company**:
The economic issuer represented by one or more securities. Multiple share classes of the same issuer belong to one company.
_Avoid_: Ticker, holding

**Company exposure**:
The portfolio value attributable to a company after combining direct positions and fund-derived positions across all of its share classes.
_Avoid_: Security allocation

**Opening balance**:
The investment positions and cash balances by currency at the start of an account's tracked history.
_Avoid_: Initial deposit

**Reported holding quantity**:
The number of units of one security recorded for one account on a given date, for example on a broker statement or account screen. It can be checked against the balance reconstructed from activity through that date.
_Avoid_: Purchase quantity

**External flow**:
A transfer of cash or securities across the boundary of the accounts included in a portfolio calculation.
_Avoid_: Investment return

**Net contribution**:
The money put into the selected accounts since tracking began: opening balances and external flows in, less external flows out.
_Avoid_: Cost basis, invested capital

**Cost basis**:
What the units of a security still held cost to acquire in its trading currency, at their average purchase price including fees. The AUD amount shown for an open holding uses the same valuation-date exchange rate as its market value.
_Avoid_: Net contribution, book value

**Unrealised gain**:
The market value of the units still held minus their cost basis in the security's trading currency. The AUD figure translates that gain at the holding's valuation exchange rate.
_Avoid_: Investment return

**Realised gain**:
The net proceeds of units sold minus their cost basis, computed in the security's trading currency and translated to AUD at the sale-date exchange rate. It measures a sale against what the units cost, whenever they were bought.
_Avoid_: Holding contribution, period gain

**Investment gain**:
The AUD change in value of the selected accounts over a period that did not come from external flows: closing valuation minus opening valuation minus net external flows.
_Avoid_: Net contribution, unrealised gain

**Gain breakdown**:
The split of a period's investment gain into five parts that always sum to it: change in unrealised gain, realised gain, dividends and interest, fees, and currency effect. Within the breakdown, unrealised and realised gains are stated before trading fees, which appear only under fees.
_Avoid_: Holding contribution

**Currency effect**:
The part of a period's investment gain caused by exchange-rate movement on foreign-currency holdings and cash. It is what remains of the investment gain after the other four parts of the gain breakdown.
_Avoid_: Realised gain, FX fee

**Daily change**:
The investment gain for one day: the valuation at the latest close on which the whole portfolio can be valued, minus the valuation at the previous such close, minus that day's net external flows. It includes exchange-rate movement, dividends, interest, and fees.
_Avoid_: Price change, broker daily P&L

**Time-weighted return**:
The cumulative AUD return of the selected accounts over a period with the effect of external flows removed. It is the only rate of return the application shows.
_Avoid_: Money-weighted return, return on contributions

**Annualised return**:
A time-weighted return of a period of at least 365 days restated as a yearly compound rate. Shorter periods have no annualised return.
_Avoid_: Average yearly return

**Company concentration**:
The share of total portfolio value, cash included, held in the largest company exposure, and in the five largest combined. Only companies are ranked; fund value that cannot be traced to a company stays in the total but is never ranked.
_Avoid_: Security weight

**Valuation snapshot**:
An account or portfolio value as of a specified date, based on the positions, cash balances, prices, and exchange rates for that valuation.
_Avoid_: Broker statement

**Account scope**:
The set of investment accounts included in every figure currently shown. One account scope applies across the overview, return review, allocation, and holdings.
_Avoid_: Filter, portfolio

**Valuation date**:
The date as of which valuation snapshots are taken. It is also the last day of the review period.
_Avoid_: Today, as-of date

**Review period**:
The date range from a chosen start through the valuation date, over which returns, gains, and contributions are measured.
_Avoid_: Time range

**Broker statement**:
A broker's dated account record used as evidence of security quantities, cash balances by currency, and, when reported, net asset value.
_Avoid_: Valuation snapshot

**Reconciliation**:
A comparison of the local ledger with a broker statement for the same account and date. A difference remains open until the supporting records explain it.
_Avoid_: Import, balance adjustment

**Portfolio under review**:
The combined investment positions and cash balances of the accounts selected for a performance review.
_Avoid_: Strategy rules

**Benchmark index**:
A named market index whose return over the review period is compared with the return of the portfolio under review.
_Avoid_: The market

**Return gap**:
The portfolio's cumulative return minus one benchmark index's cumulative return over the same period, expressed in percentage points. A positive gap means the portfolio is ahead of that benchmark.
_Avoid_: Alpha

**Holding contribution**:
The AUD gain or loss attributable to a security for the review period, including attributable dividends and trading fees. It covers the time the security was held during the period, including positions sold in full.
_Avoid_: Security return, return gap

**Underperformance period**:
An interval during which the portfolio's cumulative return from the review start is below that of a particular benchmark index. It begins on the first observed close with a negative return gap and ends when the gap returns to zero or above.
_Avoid_: Drawdown

**Review note**:
An investor's observation about the portfolio under review over a specified date range, with the benchmark indices used for that comparison.
_Avoid_: Trade note
