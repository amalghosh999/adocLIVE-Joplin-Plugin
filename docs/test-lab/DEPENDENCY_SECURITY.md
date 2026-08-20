# Production Dependency Security

adocLIVE 1.0.4 keeps the declared dependency ranges and Asciidoctor 3.0.4
unchanged. A compatible lockfile refresh resolves Mermaid 11.17.0, DOMPurify
3.4.14, Handlebars 4.7.9, lodash-es 4.18.1, brace-expansion 2.1.4, and UUID
14.0.2. The production audit changed from 1 critical, 7 high, and 3 moderate
findings to zero. The exact npm JSON reports are preserved in
[the before report](evidence/audit/production-before-lock-refresh.json) and
[the after report](evidence/audit/production-after-lock-refresh.json).

`npm run audit:prod:pr` blocks every critical production advisory and every
unexcepted high advisory. A PR-only high exception must name an owner, exact
advisory IDs, rationale, compensating controls, creation time, and an expiry no
more than 30 days later. Critical exceptions are invalid. The catalog at
`security/production-audit-exceptions.json` is initially empty.

`npm run audit:prod:release` ignores exceptions and requires zero production
advisories at every severity. The canonical candidate workflow and eventual
publication both rerun this release rule. `npm run audit:prod:nightly` retains a
complete report without weakening either gate.

## Alternatives considered

- Asciidoctor 4 and broad major dependency upgrades are long-term modernization
  work and require a separate compatibility release.
- Explicit package overrides or a maintained fork are contingencies only when
  compatible upstream ranges cannot resolve safely; 1.0.4 needs neither.
- A temporary high-severity exception is available only for a reviewed PR and
  never for a release.
- Shipping a critical exception or any production advisory in a release is
  prohibited.
