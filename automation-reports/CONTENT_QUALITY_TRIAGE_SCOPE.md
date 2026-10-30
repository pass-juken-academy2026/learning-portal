# Content-quality triage scope

The read-only content-quality scanner is run by `.github/workflows/free-api-less-audit.yml` for each of the 11 approved repositories. Changes to the scanner or its workflow trigger the audit. The scanner reports candidate duplicates, possible missing answer/explanation markers, and legal/privacy/rights review flags.

These are triage signals only. They do not prove semantic duplication, factual correctness, infringement, privacy compliance, or legal compliance. Human review is required before modifying question content. The audit does not enable A-plan writes or merge generated question changes.
