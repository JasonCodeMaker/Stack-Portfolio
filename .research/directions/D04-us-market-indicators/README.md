# [DRAFT] [D04] U.S. Market Indicators

Date: 2026-11-26

Proposal status: DRAFT

## Objective

Determine which indicators Stock Portfolio should integrate to help users understand the current U.S. equity market. Deliver a ranked shortlist, evidence of what each indicator adds beyond existing market returns, and an integration recommendation supported by source, display rights, update timing, and historical coverage. The findings can support deferring any candidate that fails the product or data checks.

## Research Question

Which combination of market sentiment, expected volatility, interest rates, and credit conditions helps users read what is changing in the U.S. equity market now? Which candidates provide distinct context, and can Stock Portfolio obtain and display each one with a reliable timestamp and clear update status?

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

## How the research will judge usefulness

On 2026-11-26, the Researcher chose current U.S. equity market context as the primary use case for the first release. [Q1 decision](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/57#issuecomment-7187018624)

1. **Additional information.** Compare the existing benchmark view with the same view plus candidate indicators across contrasting market sessions. Check whether users can correctly identify what each indicator measures, whether it rose or fell over the stated interval, and what it adds to the benchmark move. For example, when the S&P 500 falls and VIX rises, a reader can identify higher option-implied near-term volatility alongside the equity decline. The cause of the decline remains open.
2. **Distinct contribution.** Include sessions in which candidates agree and sessions in which they diverge. Check whether each standalone measure adds a specific interpretation when Fear & Greed is already visible. Recommend the smallest set that covers the supported user questions.
3. **Availability and interpretation.** For each shortlisted series, verify the publisher, units, observation time, actual availability time, refresh cadence, and history. Check permissions for programmatic retrieval, caching, and display. Include delayed or missing updates in the comparison so readers can distinguish data available for the current session from the last available observation. Use the data that would have been available at the time of each historical example, accounting for publication delays and revisions where applicable.

Historical sessions supply examples for evaluating the current-market view. Historical portfolio review and prediction are outside the first-release evaluation scope.

## Related Work and Records

- [Direction tracking issue](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/56) holds the preparation goal and relationships.
- [Preparation decision](https://github.com/JasonCodeMaker/Stack-Portfolio/issues/57) records the use-case choice and its implications for the Proposal.
