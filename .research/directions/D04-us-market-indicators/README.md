# [DRAFT] [D04] U.S. Market Indicators

Date: 2026-11-26

Proposal status: DRAFT

## Objective

Determine which indicators Stock Portfolio should integrate to help users understand the U.S. equity market. Deliver a ranked shortlist, evidence of what each indicator adds beyond existing market returns, and an integration recommendation supported by source, display rights, update timing, and historical coverage. The findings can support deferring any candidate that fails the product or data checks.

## Research Question

Which combination of market sentiment, expected volatility, interest rates, and credit conditions gives users distinct context for U.S. equity moves? For each candidate, what information was available at the time, and can Stock Portfolio obtain and display it reliably?

## Motivation

The current return review compares the portfolio with the S&P 500 and Nasdaq-100. Those series answer how the portfolio and benchmarks performed over the selected period. The proposed indicators could add context about market sentiment, expected volatility, and financing conditions around the same moves. Their incremental value remains a hypothesis. [Portfolio and benchmark methodology](../../../docs/adr/0002-portfolio-benchmark-returns.md)

## Current Understanding

The proposed route compares a small set of complementary indicators against the existing market-return view. Fear & Greed is the starting example. Its composite already includes volatility and credit-related inputs, so standalone measures should earn a place by making a distinct reading possible. Compare coverage, interpretation, and overlap before finalizing the shortlist. [CNN Fear & Greed methodology](https://www-stage-fastly.stellar.cnn.com/markets/fear-and-greed)

| Candidate | What it could help users read | First verification |
| --- | --- | --- |
| CNN Fear & Greed Index | Overall U.S. equity market sentiment | Verify a supported source, product display rights, historical depth, and timestamp semantics. [CNN indicator page](https://www.cnn.com/markets/fear-and-greed) |
| Cboe VIX | Near-term expected S&P 500 volatility inferred from option prices | Check whether the raw level and recent change add context when the composite is already visible. [Cboe VIX](https://www.cboe.com/tradable-products/vix) |
| U.S. 10-year Treasury yield (DGS10) | The level and direction of long-term U.S. rates | Check publication lag and the interpretation of daily changes. [FRED DGS10](https://fred.stlouisfed.org/series/DGS10) |
| ICE BofA U.S. High Yield option-adjusted spread | Credit-market stress for lower-rated U.S. corporate borrowers | Verify reuse terms and decide whether FRED's documented three-year history is sufficient. Compare against Fear & Greed's credit input. [FRED BAMLH0A0HYM2](https://fred.stlouisfed.org/series/BAMLH0A0HYM2) |
| U.S. Consumer Price Index | Inflation context around scheduled releases | Evaluate whether a release-date annotation adds more context than a persistent indicator. [BLS Consumer Price Index](https://www.bls.gov/cpi/) |

For each shortlisted series, document the publisher, units, observation time, actual availability time, refresh cadence, history, and stale or missing behavior. Check permissions for programmatic retrieval, caching, and product display. Compare the existing benchmark view with the smallest useful indicator set across periods with different market conditions. A historical comparison must use the values available at the time, accounting for publication delays and revisions where applicable.

The proposed first-release objective is current market context. For example, when the S&P 500 falls and VIX rises, the combined view can show that option prices implied more near-term volatility on the same day. It leaves the cause of the market move open. A historical review or a predictive use case would require different evidence.

> [!WARNING]
> **[DRAFT — NEEDS CLARIFICATION BEFORE DIRECTION CONFIRMATION]**
>
> The Researcher still needs to choose the first-release use case. That choice sets the main evaluation criteria. [Preparation decision](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/57)

## Related Work and Records

- [Direction tracking issue](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/56) holds the preparation goal and relationships.
- [Preparation decision](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/57) records the use-case choice and its implications for the Proposal.
