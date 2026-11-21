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

**Valuation snapshot**:
An account or portfolio value as of a specified date, based on the positions, cash balances, prices, and exchange rates for that valuation.
_Avoid_: Broker statement

**Broker statement**:
A broker's dated account record used as evidence of security quantities, cash balances by currency, and, when reported, net asset value.
_Avoid_: Valuation snapshot

**Reconciliation**:
A comparison of the local ledger with a broker statement for the same account and date. A difference remains open until the supporting records explain it.
_Avoid_: Import, balance adjustment
