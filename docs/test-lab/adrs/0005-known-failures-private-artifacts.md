# ADR 0005: Catalog expected failures and protect private artifacts

Status: accepted

Known defects use reviewed `ADL-*` records tied to exact desired-behavior tests, with unexpected passes treated as failures. Current bad behavior is never accepted as a baseline. Local imports are private in-memory sessions. Screenshots, traces, video, diagnostics, and exports are suppressed unless the contributor explicitly confirms persistence. CI uses synthetic fixtures only.
