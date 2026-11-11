# Confirmed review fixes — implementation plan

Goal: fix confirmed defects from the follow-up audit while preserving collaboration permissions and firewall configuration.
Spec: user requested only real issues fixed; factual baseline is the 2026-11-11 follow-up report.

Constraints: no firewall changes; server-local release artifacts go in .git/info/exclude, not commits. Preserve unrelated work. Integrate into main as explicitly requested by the user; do not create additional branches. Reuse installed dependencies.

- [x] Inspect STSS/MAGI untracked files; exclude confirmed server-local release artifacts without deleting rollback data.
- [x] Mail: reproduce ACK failure; separate SMTP delivery from DB acknowledgement; retry ACK without resending; prevent batch catch from requeueing accepted messages; add behavioral tests.
- [x] Uploads: enforce server-side file policy in reservation and Storage, preserving existing valid documents. Cover HTTP and SQL paths with behavioral tests. Do not claim content scanning without implementing it.
- [x] Counters: remove full-row JSON conversion on count-only updates; avoid schema refetch on count-only realtime updates. Preserve strict limits and existing lock order; do not introduce inversion between forms and file locks.
- [x] Public forms: user selected known-link only. RPC implemented; anon table/column SELECT revoked; no author metadata.
- [x] Raise frontend coverage thresholds to a conservative level below the recorded coverage; run current suite to verify.
- [x] Backup: user explicitly declined external backups; no backup configuration changed.
- [x] Review remaining observations: real PostgREST HTTP behavior added; no unproven access bypasses or broad refactors applied.
- [x] Run SQL integration, worker, Edge, frontend lint/typecheck/coverage/build and inspect final diff.

Rulings: current statement_timeout is not itself a bug; changing it hides contention. Strict counter serialization is necessary for the limit. Studio Basic works, GraphQL disabled and anon OpenAPI blocked; do not change these endpoints without a demonstrated issue. General refactoring based only on file size is outside “only real problems”.

Validation: 717 frontend tests; coverage lines77.97/functions72.61/branches70.55/statements74.47, floors75/70/65/70. Backend contracts/Edge133, worker31, PostgreSQL+actualPostgREST13, Playwright2 passed. Frontend lint/typecheck/build/budget and diff checks passed. Fresh review findings fixed with regression tests (nested names, MIME wildcards, remote signatures, canonical filenames, terminal mail ACK states). User subsequently authorized commit/push/main integration and production deployment. Release evidence is retained separately.
