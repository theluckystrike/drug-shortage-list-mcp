# Data sources

All sources below were fetched on 2026-11-05 while building version 1.0.0 (openFDA meta.last_updated 2026-11-05). Every listing is read at call time; nothing about any drug is written into the code.

| Data | URL | Notes |
|---|---|---|
| Drug shortage listings | https://api.fda.gov/drug/shortages.json | Keyless. One record per package NDC and company. Fields used: generic_name, presentation, package_ndc, company_name, status, availability, shortage_reason, related_info, discontinued_date, resolved_note, initial_posting_date, update_date, update_type, therapeutic_category, contact_info, openfda.brand_name. Cache 1 hour (30 minutes for the recent list). |
| Endpoint documentation | https://open.fda.gov/apis/drug/drugshortages/ | Search, sort and count syntax. |
| Rate limits | https://open.fda.gov/apis/authentication/ | Without a key, 240 requests per minute and 1,000 requests per day per IP address. |
| FDA database page | https://dps.fda.gov/drugshortages | The FDA Drug Shortages database that openFDA publishes. |

Counts on 2026-11-05 used as test expectations (from `count=status` and `count=generic_name.exact`): 1,113 Current, 425 To Be Discontinued, 59 Resolved listings; 68 distinct products with Current listings.

Test fixtures in `test/fixtures/` are raw openFDA payloads saved on 2026-11-05: searches for amphetamine, Adderall, clonazepam and a no-match term, NDC 59651-723-01, the 10 most recently updated Current listings, and four count queries.
