# Validation Resource Manifest

Date: 2026-07-13

Rate-limit inventory updated: 2026-07-14

Account: Murdawk Media Cloudflare account

Purpose: Disposable, noindex integration data for the `codex-validation` Pages alias. These resources must never be bound to production.

| Service | Validation resource | Non-secret identifier |
|---|---|---|
| D1 | `tim-lost-hunter-platform-validation` | `2ad5e924-39df-48ce-aec8-d3029b7a4abf` |
| R2 | `tim-lost-private-media-validation` | Resource name is authoritative |
| KV (retired/unbound) | `tim-lost-rate-limits-validation` | `5c32ae59aaeb421f8959f417a4751efd` |
| Queue | `tim-lost-media-processing-validation` | Resource name is authoritative |
| Dead-letter queue | `tim-lost-media-dlq-validation` | Resource name is authoritative |
| Worker | `tim-lost-media-processor-validation` | Worker name is authoritative |

Secrets, private staff principals and provider credentials are intentionally excluded. Preview configuration overrides every supported stateful Pages binding together so no validation deployment inherits production stateful resources. The Images binding belongs only to the separate media worker because Pages configuration does not support it.

Atomic campaign rate limits now use salted identifier hashes in the isolated validation D1 database after migration `0009_atomic_rate_limits.sql`. The former validation KV namespace remains listed above as non-secret historical inventory, but it is no longer bound in `wrangler.toml`. This records retirement from the application and does not state or imply that the Cloudflare resource was deleted.
