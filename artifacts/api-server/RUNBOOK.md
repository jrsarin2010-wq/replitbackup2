# API Server — Operational Runbook

## Tenant existence cache & horizontal scaling

The auth middleware (`src/middlewares/tenant.ts`) checks that the tenant
embedded in the JWT still exists before serving a request. To avoid a DB
round-trip on every API call, the result is cached in `tenantExistsCache`
(`src/lib/cache.ts`) for **5 minutes**.

### How invalidation works

| Deployment shape | Behaviour on `DELETE /api/dental/tenants/:id` |
|---|---|
| Single instance, no Redis | Local in-memory cache is cleared immediately. Safe. |
| Any number of instances, **Redis configured and healthy** | The Redis key is deleted cluster-wide (`DEL cache:tenant-exists:<id>`). Safe. |
| **Multiple instances, no Redis** | Each instance keeps its own local cache. The instance handling the DELETE clears its own copy, but other instances may still answer requests for the deleted tenant for up to the local TTL. |

### Mitigation already in place

`TenantCache` honours the `APP_INSTANCE_COUNT` environment variable. When
the value is `> 1` **and** Redis is unavailable, the local fallback TTL
for `tenantExistsCache` is reduced from 300 s to **30 s**. Staleness of a
deleted tenant is therefore bounded to 30 s on each instance.

This is implemented via the `localFallbackTtlSeconds` option on
`TenantCache` and the `isMultiInstanceDeployment()` helper in
`src/lib/cache.ts`. The check is evaluated on every `set()`, so changing
`APP_INSTANCE_COUNT` requires only a restart (no code change).

### Recommended configuration before scaling out

1. **Configure Redis first.** Set `REDIS_URL` to a shared instance reachable
   from every API server. Once Redis is healthy, deletes invalidate the
   cache cluster-wide and there is no staleness window.
2. Only after Redis is in place, increase the number of API server
   instances and set `APP_INSTANCE_COUNT` to that number.
3. If you must run multiple instances temporarily without Redis, set
   `APP_INSTANCE_COUNT=<n>` so the shorter local TTL kicks in. Stale auth
   for a deleted tenant returns empty/404 responses, never another
   tenant's data (all downstream queries are scoped by `tenant_id`), but
   you should still treat this as a degraded mode.

### Why this is safe today

The current production deployment runs a single API instance, so the
local cache and the Redis cache (when present) are the same store. The
DELETE handler in `src/routes/dental/tenants.ts` calls
`tenantExistsCache.invalidate(tenantId)` which clears both layers.

---

## Production deployment — Railway + Neon + Redis Cloud + S3

Target stack:

| Component         | Replit (today)                         | Production (target)                          |
|-------------------|----------------------------------------|----------------------------------------------|
| API host          | Replit deployment                      | Railway service (Docker, `artifacts/api-server/Dockerfile`) |
| Web host          | Replit deployment                      | Railway service (Docker, `artifacts/dental-ai/Dockerfile`) |
| Postgres          | Replit-managed                         | Neon (serverless Postgres)                   |
| Redis             | none / in-memory fallback              | Redis Cloud or Upstash (TLS)                 |
| Object storage    | Replit Object Storage (GCS sidecar)    | Cloudflare R2 / Backblaze B2 / AWS S3        |
| Secrets           | Replit Secrets                         | Railway variables                            |
| Webhook URL       | derived from `REPLIT_DOMAINS`          | `WEBHOOK_BASE_URL` set explicitly            |

The full env contract is documented in [`.env.railway.example`](../../.env.railway.example) at the repo root.

### Step 1 — Provision Neon Postgres

1. Create a Neon project (region close to Railway region). Copy the pooled connection string.
2. From a machine with the repo checked out and `DATABASE_URL` pointed at Neon:
   ```bash
   pnpm install
   pnpm db:push        # creates schema; use db:push:force if Drizzle asks
   ```
3. Snapshot the current Replit DB and restore into Neon:
   ```bash
   # On any host that can reach both DBs (e.g. local laptop):
   pg_dump --no-owner --no-acl --data-only \
     "$REPLIT_DATABASE_URL" > odontoflow-data.sql
   psql "$NEON_DATABASE_URL" -f odontoflow-data.sql
   ```
4. Validate row counts match for the critical tables:
   ```sql
   SELECT 'tenants', COUNT(*) FROM tenants
   UNION ALL SELECT 'dental_settings', COUNT(*) FROM dental_settings
   UNION ALL SELECT 'patients', COUNT(*) FROM patients
   UNION ALL SELECT 'dental_appointments', COUNT(*) FROM dental_appointments
   UNION ALL SELECT 'dental_conversations', COUNT(*) FROM dental_conversations
   UNION ALL SELECT 'dental_messages', COUNT(*) FROM dental_messages
   UNION ALL SELECT 'dental_audio_credits', COUNT(*) FROM dental_audio_credits
   UNION ALL SELECT 'dental_leads', COUNT(*) FROM dental_leads
   UNION ALL SELECT 'appointment_follow_ups', COUNT(*) FROM appointment_follow_ups;
   ```

### Step 2 — Provision Redis (Redis Cloud or Upstash)

1. Create a Redis instance with TLS enabled. Copy the `rediss://default:<pass>@<host>:<port>` URL.
2. Set `REDIS_URL` locally and run the api-server briefly. Confirm in logs:
   - No `REDIS_URL not set — Redis disabled` warning.
   - `Redis ready — shared cache enabled` appears.
3. Optional sanity check: restart the process; polling dedup state survives across restarts (look for `Polling: warm-up loaded recent externalIds from DB` rather than a fresh start).

### Step 3 — Provision Object Storage (S3-compatible)

Cloudflare R2 is recommended (no egress fees). Backblaze B2 and AWS S3 also work via the same `lib/storage/s3.ts` backend.

1. Create the bucket and an access key with read/write on that bucket.
2. Fill `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` per `.env.railway.example`.
3. Migrate existing files. The Replit object storage paths are stored on the audio/attachment rows in the DB; copy each one with `aws s3 cp` (or `rclone`):
   ```bash
   # Example with rclone, configured against both backends:
   rclone copy gcs-replit:<bucket>/.private r2:odontoflow-media/.private --progress
   rclone copy gcs-replit:<bucket>/public  r2:odontoflow-media/public  --progress
   ```
4. Spot-check a signed URL from the new bucket renders correctly in the app.

### Step 4 — Configure Railway services

1. Create two services in a Railway project, both linked to the GitHub repo `jrsarinho/backupreplitfinal` on branch `main`:
   - **api-server** — build via `artifacts/api-server/Dockerfile`. Healthcheck path: `/healthz`.
   - **dental-ai** — build via `artifacts/dental-ai/Dockerfile`. Set build arg `VITE_API_URL=https://api.<your-domain>`.
2. Paste all env vars from `.env.railway.example` into Railway. Use Railway's secret type for the `[SECRET]` ones.
3. Add custom domains: `api.<domain>` (api-server) and `app.<domain>` (dental-ai). Wait for TLS.
4. Set `WEBHOOK_BASE_URL=https://api.<domain>` and `APP_BASE_URL=https://api.<domain>` on the api-server. Restart.

### Step 5 — Cutover

Run during a low-traffic window. Have the rollback steps open in another window.

1. Lower the DNS TTL on `api.<domain>` to 60 s at least 24 h before cutover.
2. Final pass on data + objects (re-run `pg_dump`/`rclone` deltas).
3. In the Evolution API, reapoint each tenant's webhook to the new `${WEBHOOK_BASE_URL}/api/dental/webhook/whatsapp`. The api-server's webhook-sync also runs on every boot, so a Railway redeploy will refresh them automatically once `WEBHOOK_BASE_URL` is set — but doing it manually first guarantees no Replit traffic after cutover.
4. Switch DNS for `app.<domain>` and `api.<domain>` to Railway.
5. Watch the api-server logs and Telegram alerts for ~1 h.

### Rollback

If anything misbehaves within the first hour:

1. Repoint Evolution API webhooks back to the Replit URL (one tenant at a time, or via the existing `webhook-sync` if Replit env is still up).
2. Switch DNS back to Replit. Low TTL means propagation in ~1 min.
3. Replit DB still has the original data (we only exported, never wrote back), so no data reconciliation is needed.

### After cutover

- Push to `main` on GitHub triggers a Railway redeploy automatically. Graceful shutdown drains in-flight message batches first (see `src/lib/conversation-aggregator.ts` and `src/index.ts`).
- To scale to multiple instances later, follow the order in the section above: Redis first, then increase replicas, then set `APP_INSTANCE_COUNT` to the new replica count.
- The Replit project can be archived once production has been stable for one full week.

---

## WhatsApp providers — Evolution API and uazapi

The api-server speaks to WhatsApp through a pluggable provider interface. Two implementations ship today:

| Provider   | Class                              | Auth model                                     |
|------------|------------------------------------|------------------------------------------------|
| evolution  | `EvolutionApiProvider`             | `apikey` header per-instance                   |
| uazapi     | `UazapiProvider`                   | `token` header per-instance, `admintoken` for admin ops |

### How a provider is chosen for a tenant

1. If `tenants.whatsapp_provider` is set on the tenant row (`evolution` or `uazapi`), it wins.
2. Otherwise, the global default `process.env.WHATSAPP_PROVIDER` is used (`evolution` if unset).

For Evolution, `tenants.evolution_api_url` / `evolution_api_key` (decrypted) override the global `EVOLUTION_API_URL` / `EVOLUTION_API_KEY`. For uazapi, `tenants.uazapi_host` / `uazapi_admin_token` / `uazapi_instance_token` (decrypted) override the global `UAZAPI_HOST` / `UAZAPI_ADMIN_TOKEN` and the per-instance token created at provisioning.

### Required env vars

- `WHATSAPP_PROVIDER` — `evolution` (default) or `uazapi`
- Evolution: `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`
- uazapi: `UAZAPI_HOST`, `UAZAPI_ADMIN_TOKEN`

The `/healthz` deep-check endpoint reports both providers and the active default.

### Webhook handling (bi-format)

The single webhook endpoint `POST /api/dental/webhook/whatsapp` accepts both payload shapes:

- Evolution: `event = "messages.upsert" | "connection.update"`, nested `data.key.remoteJid`, `data.message.conversation`, etc.
- uazapi: `event = "messages" | "connection"`, flat `data.chatid`, `data.text`, `data.fromMe`, `data.messageType`, `data.messageid`, `data.senderName`.

uazapi payloads are normalized into the Evolution shape inside `webhook.ts` (`normalizeUazapiPayload`) before the rest of the handler runs. Tenant lookup uses `tenants.uazapi_instance_id` for uazapi events and `tenants.evolution_instance_name` for Evolution events.

### Cutover for an individual tenant (Evolution → uazapi)

1. Provision a uazapi instance for the tenant (admin → `PATCH /api/admin/tenants/:id` with `whatsappProvider: "uazapi"`, `uazapiHost`, optionally `uazapiAdminToken`). Then call `POST /api/dental/whatsapp/recreate` (impersonating the tenant) — this calls `/instance/init` on uazapi, persists the returned `uazapiInstanceId` and (encrypted) `uazapiInstanceToken`, and configures the webhook.
2. Tenant scans the new QR via `GET /api/dental/whatsapp/connect`.
3. Verify a round-trip: send an inbound message in WhatsApp; confirm the api-server logs show `providerFormat: "uazapi"` and the AI replies via `/send/text`.

### Rollback for an individual tenant (uazapi → Evolution)

1. `PATCH /api/admin/tenants/:id` with `whatsappProvider: "evolution"`. Existing Evolution instance metadata is preserved on the tenant row, so no extra credentials need to be sent.
2. Call `POST /api/dental/whatsapp/recreate` to re-issue the QR for the legacy Evolution instance (or simply call `/connect` if the Evolution session is still alive).
3. Tenant scans the QR; webhook-sync will repoint the Evolution webhook on next run (or restart the api-server to force it).

### Global cutover (all new tenants → uazapi)

1. Set `WHATSAPP_PROVIDER=uazapi` and `UAZAPI_HOST` / `UAZAPI_ADMIN_TOKEN`.
2. Restart the api-server. Existing tenants keep their `whatsapp_provider` value (default `evolution`), so they are unaffected.
3. New tenants — and any tenant whose row has `whatsapp_provider IS NULL` — will be provisioned on uazapi.
4. To roll back, set `WHATSAPP_PROVIDER=evolution` and restart.
