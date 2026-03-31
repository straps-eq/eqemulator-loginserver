# Federation Security Audit Report

**Date:** 2026-03-31
**Scope:** All federation source files in `/opt/eqemu/web/src/lib/federation/` and `/opt/eqemu/web/src/app/api/federation/`, `/opt/eqemu/web/src/app/api/admin/federation/`
**Status:** All critical, high, and medium findings remediated across Phase 1 and Phase 2. Low findings documented.

---

## Executive Summary

The federation system implements a distributed loginserver network using Ed25519 signed requests for inter-node authentication. The cryptographic primitives (libsodium) are sound, but the original implementation had **1 critical**, **6 high**, and **5 medium** severity issues across input validation, SQL construction, authentication gaps, and sensitive data handling. All critical and high findings have been fixed in this pass.

---

## Files Audited

| File | Lines | Purpose |
|------|-------|---------|
| `lib/federation/crypto.ts` | 95 | Keypair generation, signing, verification, token generation |
| `lib/federation/middleware.ts` | 122 | Request authentication, replay protection, rate limiting |
| `lib/federation/node.ts` | 370 | Node identity, initialization, peer registration, config |
| `lib/federation/sync.ts` | 270 | Sync engine, origin authority, change application |
| `lib/federation/changelog.ts` | 78 | Changelog append, query, sensitive field stripping |
| `lib/federation/client.ts` | 85 | Outbound signed HTTP requests |
| `api/federation/[action]/route.ts` | 252 | Peer-to-peer API endpoints |
| `api/admin/federation/route.ts` | 264 | Admin management endpoints |

---

## Findings

### CRITICAL — SQL Injection via Sync Payload Column Names

**File:** `sync.ts` → `applyInsert()`, `applyUpdate()`
**Status:** ✅ FIXED

**Description:** The `applyInsert` and `applyUpdate` functions constructed SQL by interpolating payload keys (column names) directly into query strings using only backtick wrapping:

```typescript
// BEFORE (vulnerable)
const colNames = columns.map((c) => `\`${c}\``).join(", ");
await conn.execute(`INSERT IGNORE INTO \`${tableName}\` (${colNames}) VALUES (${placeholders})`, values);
```

A compromised peer could craft a changelog payload with malicious column names (e.g., `` `; DROP TABLE login_accounts; -- ``). The backtick wrapping does not escape backticks within the column name.

**Fix applied:**
1. Per-table column whitelists (`ALLOWED_COLUMNS`) that enumerate every allowed column name
2. Regex validation (`/^[a-z_][a-z0-9_]{0,63}$/`) on every column name
3. `sanitizePayload()` function that filters payload before SQL construction
4. Defense-in-depth: `SYNCED_TABLES` re-check inside `applyChange()`

**Residual risk:** Low. Whitelists must be maintained when new synced columns are added.

---

### HIGH — No Replay Protection Within Timestamp Window

**File:** `middleware.ts`
**Status:** ✅ FIXED

**Description:** The middleware checked that timestamps were within a 5-minute window, but an attacker who captured a valid signed request could replay it unlimited times within that window.

**Fix applied:** Added a seen-signature cache (`seenSignatures` Map) that stores hex signatures for 6 minutes. Any duplicate signature is rejected with a `replay_detected` audit log entry. Expired entries are pruned every 2 minutes.

**Residual risk:** The cache is in-memory and per-process. In a multi-process deployment, replays could succeed on a different process. For a single-process Next.js server, this is sufficient. A Redis-backed nonce cache would be needed for multi-process.

---

### HIGH — Unauthenticated Heartbeat Leaked Node Identity

**File:** `api/federation/[action]/route.ts` → `handleHeartbeat()`
**Status:** ✅ FIXED

**Description:** The heartbeat endpoint returned `node_id`, `name`, `public_key`, `is_master`, `latest_seq`, and `latest_config_version` to any unauthenticated caller. This enabled reconnaissance — an attacker could discover the node's role, public key, and sync state.

**Fix applied:** Unauthenticated requests now receive only `{ status: "ok", timestamp: <epoch> }`. Full node details are returned only after Ed25519 signature verification.

---

### HIGH — Sync Endpoint Open When `FEDERATION_SYNC_SECRET` Unset

**File:** `api/federation/[action]/route.ts` → `handleSync()`
**Status:** ✅ FIXED

**Description:** The sync auth check was:
```typescript
if (secret && provided !== secret) // If secret is falsy, this entire check is skipped
```
If `FEDERATION_SYNC_SECRET` was not set in the environment, **any** unauthenticated request could trigger a full sync cycle.

**Fix applied:** The endpoint now returns 500 if the env var is not configured, and 401 if the provided secret doesn't match.

---

### HIGH — Bootstrap Tokens Stored as Plaintext in DB

**File:** `node.ts` → `createPeerInvite()`, `completePeerRegistration()`
**Status:** ✅ FIXED

**Description:** Bootstrap tokens were stored directly in the `bootstrap_token` column. Additionally, the placeholder `public_key` value was `pending_${token.slice(0,16)}`, leaking the first 16 characters of the token in a separate column.

**Fix applied:**
1. New `hashToken()` function using BLAKE2b (32-byte hash)
2. Only the hash is stored in `bootstrap_token`
3. Registration compares `hashToken(incoming)` against the stored hash
4. Placeholder `public_key` now uses a random value with no token material

---

### HIGH — Bootstrap Token Hashes Exposed in Admin API

**File:** `api/admin/federation/route.ts` → GET handler
**Status:** ✅ FIXED

**Description:** The admin GET endpoint returned the `bootstrapToken` field for every node, visible in browser devtools. If an admin session was compromised (XSS, session hijack), pending tokens were exposed.

**Fix applied:** Replaced `bootstrapToken: n.bootstrapToken` with `hasPendingToken: !!n.bootstrapToken` — a boolean indicator instead of the hash value. The raw token is only ever shown once, at creation time.

---

### HIGH — No Public Key Format Validation on Registration

**File:** `node.ts` → `completePeerRegistration()`
**Status:** ✅ FIXED

**Description:** The registration endpoint accepted any string as a public key. A malicious registrant could provide garbage, an oversized string, or a specially crafted value.

**Fix applied:** Ed25519 public key format validation: `/^[0-9a-f]{64}$/i` (exactly 64 hex characters = 32 bytes).

---

### HIGH — Missing Input Validation on Admin Node Management

**File:** `api/admin/federation/route.ts` → suspend/revoke/reactivate handlers
**Status:** ✅ FIXED

**Description:**
1. `node_id` was not validated — missing or non-numeric values could cause unexpected DB behavior
2. An admin could accidentally suspend/revoke the current node (self), breaking federation

**Fix applied:**
1. All three handlers now validate `node_id` is a positive number
2. `suspend_node` and `revoke_node` reject `node_id === self.id`
3. Error messages from catch blocks no longer expose `error.message` (which could contain SQL details)

---

### HIGH — Sensitive Fields in Changelog Payloads

**File:** `changelog.ts` → `appendChangelog()`
**Status:** ✅ FIXED

**Description:** The `login_accounts` table contains `account_password` (hashed). Changelog entries for inserts/updates would include password hashes in the payload, which then syncs to all peer nodes. If any peer is compromised, all password hashes are exposed.

**Fix applied:** Added `SENSITIVE_FIELDS` set and `stripSensitive()` function. Fields like `account_password`, `private_key`, `bootstrap_token`, and `verification_token` are automatically removed before changelog storage.

**Impact note:** This means password changes won't sync via the changelog. Password sync should use a dedicated, encrypted channel if needed, or the user must change their password on each node. This is the safer default.

---

### MEDIUM — Private Key Stored Plaintext in Database

**File:** `node.ts`, `crypto.ts`, DB schema `federation_nodes.private_key`
**Status:** ✅ FIXED (Phase 2)

**Description:** The Ed25519 private key was stored as hex in a VARCHAR column with no encryption.

**Fix applied:**
1. New `encryptPrivateKey()` / `decryptPrivateKey()` functions using libsodium's `crypto_secretbox` (XSalsa20-Poly1305)
2. Encryption key derived from `FEDERATION_KEY_ENCRYPTION_SECRET` env var (falls back to `SESSION_SECRET`)
3. Stored format: `enc:v1:<nonce_hex>:<ciphertext_hex>`
4. `decryptPrivateKey()` handles legacy plaintext transparently for migration
5. `private_key` column widened from VARCHAR(128) to TEXT
6. All init paths (`initializeAsMaster`, `initializeAsPeer`) encrypt before storage
7. `getSelfNode()` decrypts on read

---

### MEDIUM — `selfNodeCache` Never Invalidates on External Changes

**File:** `node.ts`
**Status:** ✅ FIXED (Phase 2)

**Description:** The in-memory cache served stale data until process restart.

**Fix applied:** Added 60-second TTL (`SELF_NODE_CACHE_TTL_MS`). Cache entries expire and are re-fetched from DB automatically. `clearSelfNodeCache()` also resets the expiry timer.

---

### MEDIUM — No TLS Enforcement in Code

**Status:** ✅ FIXED (Phase 2)

**Description:** The system accepted any URL scheme, including HTTP in production.

**Fix applied:** New `validateEndpointUrl()` function enforces:
- Valid URL format
- `http:` or `https:` protocol only
- HTTPS required in production mode (`NODE_ENV=production`), except for localhost/127.0.0.1
- Applied to `initializeAsMaster`, `initializeAsPeer`, and `createPeerInvite`

---

### MEDIUM — Origin Authority Bypassable for Unknown Records

**File:** `sync.ts`, DB schema `federation_origin_map`
**Status:** ✅ FIXED (Phase 2)

**Description:** Origin authority fell back to self-check when changelog had no provenance for a record.

**Fix applied:**
1. New `federation_origin_map` table with `(table_name, row_id) → origin_node_id` mapping
2. `isOriginNode()` now checks origin map first (authoritative, survives changelog pruning)
3. Falls back to changelog, then backfills origin map for future lookups
4. Unknown records with unverifiable claims are now **rejected** (fail-secure)
5. `recordOrigin()` called on every synced insert to populate the map
6. Separate table avoids modifying loginserver-native tables that the C++ binary reads

---

### MEDIUM — No Changelog Pruning / Unbounded Growth

**File:** `changelog.ts`, `sync.ts`
**Status:** ✅ FIXED (Phase 2)

**Description:** The changelog table grew unboundedly.

**Fix applied:**
1. New `pruneChangelog(retentionDays)` function with dual safety checks:
   - Only prunes entries with `id <=` the minimum `lastSyncSeq` across all active peers (no data loss)
   - Also enforces minimum time-based retention (default 7 days)
2. Pruning runs automatically at the end of each sync cycle
3. Origin map table ensures origin authority survives pruning

---

### LOW — `initializeAsPeer` Trusts Master Response Without Verification

**File:** `node.ts` → `initializeAsPeer()`, `crypto.ts`, `federation-dashboard.tsx`
**Status:** ✅ MITIGATED (Phase 2)

**Description:** During registration, the new peer blindly trusts the master's response. HTTPS mitigates MITM, but there's no certificate pinning.

**Mitigation applied:**
1. New `publicKeyFingerprint()` function generates human-readable colon-separated hex fingerprints (BLAKE2b-128)
2. Fingerprints displayed in the admin UI for both self node and all peers
3. Admins can compare fingerprints out-of-band (e.g., over phone/Signal) to verify node identity
4. Full certificate pinning remains a future enhancement for high-security deployments

---

### LOW — Rate Limit is In-Memory Only

**File:** `rate-limit.ts`
**Status:** ⚠️ DOCUMENTED

**Description:** Rate limits reset on server restart and aren't shared across processes. Acceptable for single-process Next.js but would need Redis backing for multi-process.

---

### LOW — 15-Second Fetch Timeout

**File:** `client.ts`
**Status:** ⚠️ DOCUMENTED

**Description:** The federation HTTP client uses a 15-second timeout. A malicious peer could intentionally respond slowly, tying up resources. With the rate limiter and async nature, this is low risk but could contribute to resource exhaustion under sustained attack.

---

## Summary of Changes Made

| Severity | Finding | File(s) | Fix |
|----------|---------|---------|-----|
| **CRITICAL** | SQL injection via payload column names | `sync.ts` | Column whitelists + regex validation |
| **HIGH** | No replay protection in timestamp window | `middleware.ts` | Seen-signature cache |
| **HIGH** | Heartbeat leaks node identity | `[action]/route.ts` | Minimal unauthenticated response |
| **HIGH** | Sync endpoint open without secret | `[action]/route.ts` | Require env var |
| **HIGH** | Bootstrap tokens stored plaintext | `node.ts`, `crypto.ts` | BLAKE2b hashing |
| **HIGH** | Token hash exposed in admin API | `admin/federation/route.ts` | Boolean indicator only |
| **HIGH** | No public key format validation | `node.ts` | Hex regex validation |
| **HIGH** | Missing node_id validation / self-revocation | `admin/federation/route.ts` | Type + range + self checks |
| **HIGH** | Passwords in changelog payloads | `changelog.ts` | Sensitive field stripping |
| MEDIUM | Private key plaintext in DB | `node.ts`, `crypto.ts` | XSalsa20-Poly1305 encryption at rest (Phase 2) |
| MEDIUM | Stale self-node cache | `node.ts` | 60-second TTL (Phase 2) |
| MEDIUM | No TLS enforcement | `node.ts` | HTTPS required in production (Phase 2) |
| MEDIUM | Origin authority bypassable | `sync.ts`, schema | `federation_origin_map` table (Phase 2) |
| MEDIUM | Unbounded changelog growth | `changelog.ts`, `sync.ts` | Auto-pruning with peer safety (Phase 2) |
| LOW | No out-of-band key verification | `crypto.ts`, dashboard | Public key fingerprints in UI (Phase 2) |

---

## Cryptographic Assessment

The cryptographic primitives are well-chosen:

- **Ed25519** (via libsodium `crypto_sign`) — strong, modern signature scheme
- **BLAKE2b** (via `crypto_generichash`) — fast, secure hash for body and token hashing
- **randombytes_buf** — cryptographically secure random for token generation
- **Signature message format** — includes timestamp, method, path, and body hash, preventing cross-method/cross-path signature reuse

No issues found in the cryptographic layer itself.

---

## Phase 2 Migration

Run `002_security_phase2.sql` on each node:

```bash
docker exec -i eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login \
  < /opt/eqemu/web/migrations/002_security_phase2.sql
```

Grant permissions:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON eqemu_login.federation_origin_map TO 'eqemu_web'@'%';
FLUSH PRIVILEGES;
```

Optionally set `FEDERATION_KEY_ENCRYPTION_SECRET` env var (falls back to `SESSION_SECRET`).
Existing plaintext private keys are transparently handled — `decryptPrivateKey()` detects legacy format.
New keys are always encrypted. To re-encrypt an existing key, re-initialize the node.

---

## Phase 3 Implementation

### Redis-Backed Nonce Cache & Rate Limiter

**Files:** `src/lib/redis.ts` (new), `src/lib/rate-limit.ts`, `src/lib/federation/middleware.ts`
**Status:** ✅ IMPLEMENTED

- New `redis.ts` module with `cacheSet`, `cacheGet`, `cacheExists`, `cacheIncr`, `cacheTTL`
- Automatic in-memory fallback if `REDIS_URL` is not set or Redis is unreachable
- Replay nonces now stored in Redis (`nonce:<signature>` keys with 6-min TTL)
- Rate limiter rewritten to use `cacheIncr` — shared across processes via Redis
- All 7 `rateLimit()` callers updated to `await` (now async)
- Redis added to `docker-compose.yml` (redis:7-alpine, 64MB, allkeys-lru)
- Web service gets `REDIS_URL=redis://redis:6379` env var

### Dedicated Password Sync Channel

**Files:** `src/app/api/federation/[action]/route.ts`, `src/lib/federation/client.ts`
**Status:** ✅ IMPLEMENTED

- New `POST /api/federation/password_sync` endpoint
- Fully Ed25519-authenticated (same as all federation endpoints)
- Accepts `{ updates: [{ table, row_id, password_hash }] }`
- Strict table whitelist: only `login_accounts.account_password` and `login_server_admins.account_password`
- Max hash length 512 chars, row_id must be positive integer
- New `broadcastPasswordChange()` client function pushes to all active peers
- Audit logged on both send and receive

### TLS Certificate Pinning

**Files:** `src/lib/federation/client.ts`, `src/db/schema.ts`
**Status:** ✅ IMPLEMENTED

- New `tls_cert_hash` column on `federation_nodes` (optional VARCHAR(128))
- `createPinnedAgent()` creates an `https.Agent` with `checkServerIdentity` callback
- Compares SHA-256 fingerprint of server certificate against pinned hash
- Passed through `federationGet`/`federationPost` → `federationFetch` → `fetch`
- Sync engine passes `peer.tlsCertHash` on every outbound request
- When `tls_cert_hash` is NULL, no pinning occurs (standard TLS verification only)
- Admins can set the hash via direct DB update or future admin API extension

### Audit Log Retention

**Files:** `src/lib/federation/changelog.ts`, `src/lib/federation/sync.ts`
**Status:** ✅ IMPLEMENTED

- New `pruneAuditLog(retentionDays)` function — deletes entries older than N days
- Default retention: 90 days
- Runs automatically at end of each sync cycle (after changelog pruning)
- No peer sync safety needed — audit logs are local-only

---

## Phase 3 Migration

Run `003_security_phase3.sql` on each node:

```bash
docker exec -i eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login \
  < /opt/eqemu/web/migrations/003_security_phase3.sql
```

Add Redis to Docker stack (already in `docker-compose.yml`):
```bash
docker compose up -d redis
```

Set `REDIS_URL=redis://redis:6379` in the web service environment.
Redis is optional — all features gracefully fall back to in-memory if unavailable.

---

## Tiered Federation Architecture

### Node Tiers

| Tier | Count | Role | Gets Passwords? | Can Push Changes? |
|------|-------|------|-----------------|-------------------|
| **Master** | 1 | Source of truth, arbitrates conflicts | Yes | Yes (origin) |
| **Official** | 2-3 | Trusted replicas, full data | Yes | Yes |
| **Mesh** | Unlimited | Community-operated, local access | Yes (strong only) | Read-only |

**Files:** `src/db/schema.ts`, `src/lib/federation/node.ts`, `src/lib/federation/sync.ts`, `src/app/api/admin/federation/route.ts`, `src/app/admin/federation-dashboard.tsx`

**Implementation:**
1. New `node_tier` ENUM column on `federation_nodes`: `official` or `mesh`
2. Master nodes are always `official` tier (enforced in init + admin API)
3. New peers default to `mesh` tier — master admin can promote to `official`
4. **Sync engine skips pulling changes from mesh peers** — mesh nodes are read-only consumers
5. Official nodes sync bidirectionally — their changes propagate across the federation
6. Admin UI shows tier badges and Promote/Demote buttons (master only)
7. `set_tier` admin action with validation: cannot demote master, only master can change tiers

### Password Hash Strength Enforcement

**Files:** `src/app/api/federation/[action]/route.ts`, `src/lib/federation/client.ts`

Only scrypt (`$7$`) and argon2id (`$argon2id$`) password hashes are allowed across the federation:

- **Outbound** (`broadcastPasswordChange`): refuses to send weak hashes, logs `password_sync_blocked_weak_hash`
- **Inbound** (`handlePasswordSync`): rejects weak hashes, returns `rejected_weak_hash` count in response
- Weak hashes (md5, sha) are never transmitted — accounts auto-upgrade on next login via the loginserver
- Both sides enforce independently (defense-in-depth)

### Security Properties

| Scenario | Impact |
|----------|--------|
| Mesh node compromised | Attacker sees usernames + strong hashes only (scrypt/argon2). No weak hashes. Read-only — can't poison federation data. |
| Official node compromised | Full data exposure. Mitigated by limiting to 2-3 trusted operators. |
| Mesh node goes rogue | Changes are ignored — official nodes don't pull from mesh tier. |
| Weak hash in local DB | Never synced. Auto-upgrades to scrypt on next player login. |

### Migration

Run `004_tiered_federation.sql`:
```bash
docker exec -i eqemu-mariadb mysql -u root -p"$DB_ROOT_PASSWORD" eqemu_login \
  < /opt/eqemu/web/migrations/004_tiered_federation.sql
```

---

## API Route Security Audit

Comprehensive audit of all 20 API routes for authentication posture, data exposure, and PII leakage.

### Route Authentication Matrix

| Route | Method | Auth Required | Data Classification |
|-------|--------|---------------|---------------------|
| `/api/servers` | GET | None | Public (server list, player counts) |
| `/api/servers/[id]` | GET | None | Public (server detail, profile) |
| `/api/servers/[id]/history` | GET | None | Public (player count timeseries) |
| `/api/status` | GET | None (public) / Admin (system) | Mixed — tiered response |
| `/api/metrics` | GET | Internal only | Infrastructure (Prometheus scrape) |
| `/api/account/register` | POST | None | Rate limited + captcha |
| `/api/account/login` | POST | None | Rate limited |
| `/api/account/logout` | POST | None | Session destroy |
| `/api/account/verify-email` | POST | Token-based | Email verification |
| `/api/account/password` | POST | Session | Rate limited + old password |
| `/api/account/loginserver-accounts` | GET | Session | User's linked accounts |
| `/api/account/create-loginserver` | POST | Session | Rate limited |
| `/api/account/link-loginserver` | POST | Session | Rate limited |
| `/api/account/worldserver-accounts` | GET | Session | Operator accounts + encrypted passwords |
| `/api/account/worldserver-accounts` | POST | Session | Rate limited, creates admin account |
| `/api/account/worldserver-accounts/[id]` | PUT | Session + Owner | Password reset / profile update |
| `/api/account/worldserver-accounts/[id]` | DELETE | Session + Owner | Account deletion |
| `/api/account/worldserver-accounts/[id]/banner` | POST | Session + Owner | Image upload |
| `/api/admin/accounts` | GET/PUT/DELETE | Admin | Full account management |
| `/api/admin/federation` | GET/POST | Admin | Federation management |
| `/api/federation/*` | GET/POST | Ed25519 / Token | Peer-to-peer federation |

### Findings & Fixes

**1. `/api/status` exposed system internals (HIGH)**
- CPU, memory, disk, network, DB row counts, service latencies were public
- **Fix:** Split into tiered response — public gets health status + player summary only. System metrics require admin session.
- **File:** `src/app/api/status/route.ts`

**2. `/api/metrics` publicly accessible (HIGH)**
- Prometheus scrape endpoint reachable from the internet
- **Fix:** Restricted to internal Docker network IPs (172.x, 10.x, 127.0.0.1) or optional `METRICS_BEARER_TOKEN`
- **File:** `src/app/api/metrics/route.ts`

**3. `/api/servers/[id]` exposed `lastIpAddress` (HIGH)**
- Server operator's IP address (PII) returned in public response
- **Fix:** Removed `last_ip_address` from JSON response
- **File:** `src/app/api/servers/[id]/route.ts`

**4. WS admin passwords stored in plaintext (HIGH)**
- `worldServerAdminLinks.accountPassword` stored raw plaintext for operator retrieval
- **Fix:** Now encrypted with XSalsa20-Poly1305 via `encryptString()` / `decryptString()` (same key derivation as federation private keys). Legacy plaintext transparently handled on read.
- **Files:** `src/app/api/account/worldserver-accounts/route.ts`, `src/app/api/account/worldserver-accounts/[id]/route.ts`, `src/lib/federation/crypto.ts`

**5. `/api/account/loginserver-accounts` returned `lastIpAddress` (MEDIUM)**
- Player's last login IP (PII) included in account details
- **Fix:** Removed from select query
- **File:** `src/app/api/account/loginserver-accounts/route.ts`

**6. `/api/account/worldserver-accounts` returned full server rows (MEDIUM)**
- `loginWorldServers` selected with `*`, exposing `lastIpAddress` of servers
- **Fix:** Explicit column selection excluding IP addresses
- **File:** `src/app/api/account/worldserver-accounts/route.ts`

**7. Federation changelog propagated `registration_ip_address` (MEDIUM)**
- WS account creation sent operator IP in changelog payload across federation
- **Fix:** Removed `registration_ip_address` from changelog entry
- **File:** `src/app/api/account/worldserver-accounts/route.ts`

---

## All Findings — Final Status

| Phase | Severity | Finding | Status |
|-------|----------|---------|--------|
| 1 | **CRITICAL** | SQL injection via payload column names | ✅ Fixed |
| 1 | **HIGH** | No replay protection in timestamp window | ✅ Fixed |
| 1 | **HIGH** | Heartbeat leaks node identity | ✅ Fixed |
| 1 | **HIGH** | Sync endpoint open without secret | ✅ Fixed |
| 1 | **HIGH** | Bootstrap tokens stored plaintext | ✅ Fixed |
| 1 | **HIGH** | Token hash exposed in admin API | ✅ Fixed |
| 1 | **HIGH** | No public key format validation | ✅ Fixed |
| 1 | **HIGH** | Missing node_id validation / self-revocation | ✅ Fixed |
| 1 | **HIGH** | Passwords in changelog payloads | ✅ Fixed |
| 2 | MEDIUM | Private key plaintext in DB | ✅ Fixed |
| 2 | MEDIUM | Stale self-node cache | ✅ Fixed |
| 2 | MEDIUM | No TLS enforcement | ✅ Fixed |
| 2 | MEDIUM | Origin authority bypassable | ✅ Fixed |
| 2 | MEDIUM | Unbounded changelog growth | ✅ Fixed |
| 2 | LOW | No out-of-band key verification | ✅ Mitigated |
| 3 | LOW | In-memory-only rate limits / nonces | ✅ Fixed |
| 3 | LOW | No password sync channel | ✅ Fixed |
| 3 | LOW | No TLS certificate pinning | ✅ Fixed |
| 3 | LOW | No audit log retention | ✅ Fixed |
| 4 | ARCH | No node trust tiers | ✅ Implemented |
| 4 | ARCH | Weak hashes could propagate | ✅ Enforced (scrypt/argon2 only) |
| 4 | ARCH | Mesh nodes could push bad data | ✅ Blocked (read-only tier) |
| API | **HIGH** | `/api/status` exposes system internals | ✅ Fixed (admin-gated) |
| API | **HIGH** | `/api/metrics` publicly accessible | ✅ Fixed (internal-only) |
| API | **HIGH** | Server operator IP exposed publicly | ✅ Fixed (stripped) |
| API | **HIGH** | WS admin passwords stored plaintext | ✅ Fixed (encrypted at rest) |
| API | MEDIUM | Player login IP in API response | ✅ Fixed (stripped) |
| API | MEDIUM | Server IPs in WS accounts response | ✅ Fixed (explicit select) |
| API | MEDIUM | Registration IP in federation changelog | ✅ Fixed (stripped) |
