# Portfolio Management

This context describes how account activity and tradable positions become portfolio valuations, allocation, and economic exposure.

## Language

**Security**:
A tradable instrument or share class identified by its ticker, such as GOOGL Class A or GOOG Class C.
_Avoid_: Company, issuer

**Company**:
The economic issuer represented by one or more securities. Multiple share classes of the same issuer belong to one company.
_Avoid_: Ticker, holding

**Company exposure**:
The portfolio value attributable to a company after combining direct positions and fund-derived positions across all of its share classes.
_Avoid_: Security allocation

**Opening balance**:
The investment positions and cash balances by currency at the start of an account's tracked history.
_Avoid_: Initial deposit

**External flow**:
A transfer of cash or securities across the boundary of the accounts included in a portfolio calculation.
_Avoid_: Investment return

**Net contribution**:
The money put into the selected accounts since tracking began: opening balances and external flows in, less external flows out.
_Avoid_: Cost basis, invested capital

**Cost basis**:
What the units of a security still held cost to acquire, at their average purchase price including fees.
_Avoid_: Net contribution, book value

**Unrealised gain**:
The current value of a holding minus its cost basis. In AUD it includes the effect of exchange-rate changes since each purchase.
_Avoid_: Investment return

**Valuation snapshot**:
An account or portfolio value as of a specified date, based on the positions, cash balances, prices, and exchange rates for that valuation.
_Avoid_: Broker statement

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

**Underperformance period**:
An interval during which the portfolio's cumulative return from the review start is below that of a particular benchmark index. It begins on the first observed close with a negative return gap and ends when the gap returns to zero or above.
_Avoid_: Drawdown

**Review note**:
An investor's observation about the portfolio under review over a specified date range, with the benchmark indices used for that comparison.
_Avoid_: Trade note
