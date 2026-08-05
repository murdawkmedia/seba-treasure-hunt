# Tim Lost Something Service API Runbook

## Purpose

The service API provides scoped machine access without sharing a human Clerk
session or copying production records into another database. The SebaHub
Console uses a read-only production key. A separately scoped key can power the
local Tim Lost Something MCP adapter.

The versioned contract is
[`docs/openapi/tim-lost-service-v1.yaml`](openapi/tim-lost-service-v1.yaml).

## Key control

Only an active staff user whose verified email is listed in the server-side
`API_KEY_ADMIN_EMAILS` setting can create, list, rotate, or revoke keys. The
initial administrators are Murphy and Tech. A service key can never use these
endpoints.

A new or rotated plaintext key appears once. Copy it immediately into an
ignored local environment file or the destination provider's secret store.
The application stores only an HMAC-SHA-256 hash and a short identifying
prefix. Keys do not expire by default; an optional expiry can be supplied.

Rotation creates a replacement key and leaves the prior key active for a
controlled overlap. Verify the replacement first, then revoke the old key.
Revocation is immediate.

## Scope recipes

SebaHub Console read-only key:

```text
case.read reports.read media.read publishing.read moderation.read
inquiries.read people.read legal.read staff.read audit.read
```

Full case-operations key:

```text
case.read case.write reports.read reports.write media.read media.write
publishing.read publishing.write moderation.read moderation.write
inquiries.read inquiries.write people.read legal.read staff.read audit.read
```

There are deliberately no `staff.write`, `people.write`, `legal.write`, or
`keys.write` scopes. Human staff retain those workflows in Case Room.

## Authentication and guards

Send the service key only in the Authorization header:

```http
Authorization: Bearer tls_prod_...
```

Every machine mutation also requires:

```http
X-Tim-Confirm: true
Idempotency-Key: one-stable-key-for-this-exact-operation
```

The server binds an idempotency key to the service key, method, path, query,
content type, and request-body hash. An exact retry replays the stored result;
a changed request returns a conflict. Limits are 300 reads, 60 mutations, and
20 uploads per key and IP per minute.

## Environment isolation

Validation keys begin with `tls_val_` and are rejected by production.
Production keys begin with `tls_prod_` and are rejected by validation. The
server also binds every stored key to its deployment environment.

Required server secret:

```text
TIM_LOST_API_KEY_PEPPER
```

Required non-secret server setting:

```text
API_KEY_ADMIN_EMAILS=murphy@sebahub.com,tech@sebahub.com
```

Do not put a key in any `VITE_` variable, public JavaScript, source-controlled
file, URL, query string, log, screenshot, support message, or test fixture.

## Verification

Read-only smoke test:

```powershell
$headers = @{ Authorization = "Bearer $env:TIM_LOST_API_KEY" }
Invoke-RestMethod "$env:TIM_LOST_API_BASE/service/session" -Headers $headers
Invoke-RestMethod "$env:TIM_LOST_API_BASE/service/capabilities" -Headers $headers
Invoke-RestMethod "$env:TIM_LOST_API_BASE/ops/items" -Headers $headers
```

Before enabling a consumer, verify the returned environment and exact scopes.
Test insufficient scope, a wrong-environment key, an idempotent retry, a
conflicting retry, rate limiting, rotation overlap, and old-key revocation.

## Incident response

1. Revoke the affected key from an approved human administrator session.
2. Confirm `/service/session` rejects it.
3. Review `service_key_events`, `service_api_idempotency`, and the ordinary Ops
   audit trail without editing them.
4. Create a replacement with the smallest required scopes.
5. Update only the destination secret store and verify it before resuming.
6. Rotate `TIM_LOST_API_KEY_PEPPER` only as a deliberate all-keys incident;
   doing so invalidates every existing key.
