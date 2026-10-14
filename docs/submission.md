# Deployment and SnapTrade submission

BALANCE implements the full product path: a calculation-backed public landing page, explicit interactive demo, guided connection setup, reviewed workspace preferences, an account-funded simulation, immutable saved history, and practical help and recovery. Real SnapTrade OAuth and production persistence were verified with simulated Sandbox accounts on October 14, 2026. This guide records that evidence and the remaining public-launch requirements.

## 1. Register OAuth and a Personal test user

In a **Commercial** [SnapTrade Dashboard](https://dashboard.snaptrade.com) workspace, open **OAuth Apps**, create a Test app, and save its client ID and client secret. A Commercial API `clientId`/`consumerKey` pair is a different credential type and will not configure this OAuth integration. The application requests `openid read`.

Register the callbacks you will actually use:

```text
http://localhost:3000/api/auth/callback
https://balance-snaptrade.vercel.app/api/auth/callback
```

Redirect matching includes scheme, host, port, path, and trailing slash. A preview URL requires its own registered callback and matching `APP_URL`; use a stable origin for the normal production flow.

In a separate **Personal** workspace, connect a brokerage. For testing, use SnapTrade Sandbox's self-directed scenario. That Personal user signs in and authorizes Balance's access to their existing connections; the Commercial workspace owns the app. Customers manage additions and reconnects in SnapTrade Personal, then return to Balance to reload available data.

Test OAuth apps permit up to five users. Registering a Production OAuth app requires SnapTrade's production approval. Follow the current [OAuth guide](https://docs.snaptrade.com/docs/oauth-apps) and [Sandbox guide](https://docs.snaptrade.com/docs/sandbox) for account setup and approval requirements.

## 2. Configure local development

Use Node.js 22:

```sh
npm ci
cp .env.example .env.local
openssl rand -base64 32
```

Set these values in `.env.local`:

```dotenv
SNAPTRADE_CLIENT_ID=your-oauth-client-id
SNAPTRADE_CLIENT_SECRET=your-oauth-client-secret
APP_URL=http://localhost:3000
SESSION_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
DATABASE_URL=your-postgres-connection-string
SESSION_STORE=memory
```

A populated `DATABASE_URL` takes precedence over `SESSION_STORE=memory`. To explore locally without Postgres, leave the database URL empty and explicitly use the memory setting. The sample `/demo` works without OAuth credentials. Memory-backed connected sessions, preferences, and plans disappear when the server restarts and cannot establish durable persistence.

For database-backed use, apply **all checked-in migrations in order** through a provider SQL editor or a migration connection:

```sh
node --env-file=.env.local scripts/migrate.mjs
```

The runner applies the checked-in SQL in one transaction, records SHA-256 checksums, and serializes concurrent runs. Repeating it is safe; changing or removing an applied migration fails before any pending migration commits. It prefers `MIGRATION_DATABASE_URL`, then `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`.

They create sessions/login attempts, workspace policies/plan history/deletion generations, the portfolio snapshot cache, and encrypted support conversations with retry/deletion protection. The runtime role needs `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on those tables. New tables need explicit grants for the restricted runtime role. The application does not automatically run migrations.

```sh
npm run dev
```

Open the exact `APP_URL` origin, then `/app` to sign in or `/demo` to explore. Restart after changing environment values. If using port 3001, update both `APP_URL` and the registered callback to that port.

## 3. Deploy the connected application

1. Provision hosted Postgres using the provider's required TLS settings and apply all migrations above.
2. Link the repository to the `balance-snaptrade` Vercel project, or another compatible Node hosting environment. Configure Node.js 22, `npm ci`, and `npm run build` from the repository root.
3. Set `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEY`, `DATABASE_URL`, and `APP_URL` as server environment variables. For the existing public domain, use `APP_URL=https://balance-snaptrade.vercel.app` with no trailing slash. Production requires Postgres; the memory adapter is never a production option.
4. Register the exact HTTPS callback and redeploy after changing credentials, origin, or database configuration.
5. Open `/api/health` (process liveness), `/api/status` (configuration and complete database schema readiness), `/`, `/demo`, `/privacy`, and `/app` on the deployed domain, then complete the release checks below.
6. Verify the intended support operator's authenticated setup key, configure server-only `SUPPORT_ADMIN_SUBJECT_HASHES`, redeploy, and test `/support/inbox`. Without an operator, new requests remain disabled. Follow the [operations runbook](operations.md) for the access grant and deletion/retention contract.

Keep credentials out of `NEXT_PUBLIC_*`, source control, and logs. Preserve the encryption key across deployments: sessions, policies, saved snapshots, and cached financial payloads depend on it. Separate production and preview databases/keys when they represent different environments. Use a migration role for table creation and a restricted runtime role for normal application access.

## 4. Run automated verification

Recorded local verification on October 14, 2026: **226 unit/integration tests and 10 migration tests**, including disposable real Postgres checks, plus **43 Chromium browser tests** with axe accessibility checks.

```sh
npm run typecheck
npm test
npm run test:migrations
npm run build
npx playwright install chromium
npm run test:e2e
```

Postgres suites require a disposable **loopback** database whose name starts with `balance_test`. For example:

```sh
TEST_DATABASE_URL=postgresql://127.0.0.1:5432/balance_test_product npm test
```

Without that environment value, the database-specific suites skip. They reject remote hosts and other database names to keep integration-test mutations away from live data. CI provisions Postgres and runs type checking, tests, build, and Chromium verification.

The explicit logical recovery drill passed two checks with synthetic encrypted sessions, policy, saved plans, cache, support messages, and deletion markers. It uses fresh loopback databases and a disposable key:

```sh
TEST_DATABASE_URL=postgresql://127.0.0.1:5432/balance_test_product npm run test:recovery
```

It requires compatible `pg_dump` and `pg_restore` tools and a local role allowed to create disposable databases. It verifies restored ciphertext, same-key reads, ownership isolation, and wrong-key rejection; it is not evidence of Neon point-in-time restore or recovery of the production encryption key.

Browser tests start or reuse `http://127.0.0.1:3001`. `PLAYWRIGHT_BASE_URL` can target an existing instance. They cover sample isolation, explicit policy saves, immutable historical prices and constraints, session/error gates, empty-account recovery, history retry, deletion, mobile layout, and automated WCAG A/AA checks. Connected browser journeys use controlled API responses; they do not authorize a real SnapTrade user. `CAPTURE_SCREENSHOTS=1` refreshes `docs/images/portfolio.png` and `rebalance.png`.

## 5. Establish live release evidence

Run these checks against the deployed application with the configured Personal test user. Record the environment, date, outcome, and any limitation. Do not treat an automated test or successful build as evidence of an untested row.

| Check                         | Required evidence                                                                                                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public and sample entry       | `/` offers clear choices; `/demo` uses labeled sample data and sends no private API requests. `/app` never shows sample holdings while loading or recovering.                                               |
| OAuth round trip              | Consent occurs at SnapTrade and returns to the exact HTTPS callback; accounts shown belong to the consenting Personal user.                                                                                 |
| Denial and expiry             | Denied consent, expired session, or revoked authorization produces a useful sign-in/retry path without private data being replaced by sample results.                                                       |
| Brokerage management          | Empty/disabled connections lead to Personal dashboard management; returning and reloading retrieves available normalized data.                                                                              |
| First policy and return visit | Review and save targets, reserve, asset classifications, and tax treatment. Reload, sign in again, and use a new server instance to verify those saved choices return.                                      |
| Feasible plan                 | Purchases fit their own account's modeled funds; proposed shares are integers; taxable sales require opt-in; missing/stale/unsupported inputs block.                                                        |
| Save provenance               | Save a named plan, change policy or source prices, and reopen history. Original holdings, prices, sync times, policy, and result remain unchanged; export is explicitly historical.                         |
| Durable history               | Saved policies and plans survive redeployment with the same database/key and remain isolated between two Personal users.                                                                                    |
| Cache boundaries              | Immediate portfolio reload can reuse the 45-second server cache without claiming newer source data. An expired/deleted session cannot read a cached payload. Saving a plan performs its own source read.    |
| Privacy controls              | Delete one plan; delete all workspace data; verify preferences/history are gone and prior cached snapshots are invalidated. Disconnect separately and verify saved history remains for later authorization. |
| Revocation recovery           | Disconnect deletes local credentials and attempts remote revocation. An unconfirmed revocation gives the Personal-dashboard removal instruction.                                                            |
| Failure recovery              | Account-data failures, rate limits, and saved-history failures have actionable recovery; a history failure does not prevent use of the loaded portfolio.                                                    |

Use controlled server tests for token-rotation races and forced protocol failures that are difficult to reproduce interactively. Observe actual production behavior for consent, broker normalization, persistence, and isolation.

## 6. Reviewer walkthrough and submission

A focused demonstration:

1. Enter `/demo` explicitly from the landing page and review your target mix and reserve.
2. Inspect the same account's trades and funding ledger; compare taxable-sale permission or a hypothetical contribution.
3. Save a named snapshot, change current preferences, and show that historical holdings/prices and policy remain intact.
4. Inspect a stale/missing-data scenario and its blocked plan.
5. After live verification, repeat the connected journey in `/app`, demonstrate persistence, and explain the separate delete/disconnect controls.

Explain the bounded heuristic, source freshness versus retrieval time, the cache's authentication boundary, server recalculation before saving, and why hypothetical results are never executable orders.

After the public OAuth and persistence checks pass, use the [Product Engineer application](https://careers.snaptrade.com/product-engineer) to select the associated Commercial project, provide the public URL, and supply the requested professional profile. This repository does not submit an application on your behalf.

Suggested project description:

> BALANCE is a read-only portfolio planning workspace for investors with USD stocks and ETFs across brokerage accounts. It turns personal allocation targets into whole-share, account-funded simulations, preserves user-reviewed assumptions, and saves immutable historical plans with their original data. Taxable sales require explicit permission, incomplete data pauses recommendations, and every result exposes its funding and remaining drift. The model excludes execution, fees, taxes, settlement, FX, and a guarantee of global optimality.

## Operating the beta and preparing a wider launch

Use `/api/health` for process liveness and `/api/status` for database/schema readiness. A healthy process does not prove that the database or SnapTrade is available. Public pages and the sample workspace remain independent of private service availability.

API failures include a random `requestId` in the JSON response and `X-Request-Id` header. The workspace displays validated references with its error message. Transient service failures and rate limits emit structured `balance.request.failed` log records containing only the reference, bounded service code, and status. Do not add raw errors, URL queries, request bodies, token claims, account IDs, financial payloads, or support messages to those records. `/support/inbox` keeps authenticated private conversations inside Balance. `/support` also offers an optional public draft for non-sensitive bugs; the customer reviews and submits it themselves.

For an incident, correlate a reported reference with Vercel runtime logs, check readiness, and identify whether the failure is in the app, database, or upstream connection. Keep account data out of public issues. A service outage should produce a retry path, never a fabricated successful plan. If a release introduces a regression, inspect the intended project and roll back to a previously verified deployment; keep the same encryption key and database. No automatic rollback or alerting service is configured by this repository.

Keep the encryption key stable. A database backup cannot recover encrypted payloads without the matching key. The dedicated Neon project reported a 24-hour restore window on October 14, 2026. The local logical restore drill uses synthetic data and a disposable key; recovery of production data with its original encryption key has not been rehearsed. Before retaining real customer financial records, establish operator-controlled recovery of that key and exercise provider restore in an isolated environment. Never point disposable tests at production or rotate the key without a migration/recovery plan. See [operations](operations.md).

Before wider connected access, finish SnapTrade production approval, register production credentials and intended consent branding, verify supported real brokerage accounts and a second external Personal identity, establish operational alerts and production key recovery, and review company policies. Private support is implemented with an explicit operator allowlist; it has no email notifications or guaranteed response time during the beta. Pricing, billing, and a legal company identity are not invented by this application.

## Deployment verification status

The public project URL is [balance-snaptrade.vercel.app](https://balance-snaptrade.vercel.app), with the intended callback `https://balance-snaptrade.vercel.app/api/auth/callback`.

### Private support and operations release — October 14, 2026

Published application commit `3bfc5e9` as deployment `dpl_C5DDhJjUgDCCYt3wco7peZTmQnPa`, running Node.js 22. [Release CI passed](https://github.com/meetgojiya98/SnapTrade/actions/runs/38630068955): **226 unit/integration tests, 10 migration tests, two recovery checks, and 43 Chromium tests (281 total)**, plus dependency advisory checks, type checking, and production build. The recovery test used PostgreSQL 17.11 tools in CI and restored all ten tables, including the migration ledger. A CI-only follow-up explicitly configured the official PostgreSQL package repository after the runner lacked client 17.

Migration `004_support.sql` was applied first to an expiring child branch of the production database. Existing table counts were preserved, repeating the migration made no changes, and the restricted runtime role passed schema/CRUD checks. The unchanged migration and grants were then applied to production. Only the three new support tables received additional CRUD grants; runtime schema/role/database creation remains disabled. The temporary branch and its local connection file were removed after verification.

The owner explicitly approved their current authenticated identity as the first support operator. Its private setup key was configured in the server-only production allowlist; neither the raw subject nor the allowlist is published. The live inbox exposed the operator queue and accepted a clearly labeled, non-sensitive launch test. Creation, reply, resolution, and reload persistence succeeded. Both the transcript and list summary were verified as encrypted database envelopes. That resolved test conversation remains available for inspection. Existing real Sandbox authorization and the original saved planning history still loaded after deployment. Anonymous support access returned 401 with no-store headers and a safe reference; public production journey tests passed. The post-release runtime warning/error scan returned zero records.

Three Checkly monitors were saved and passed: public demo availability every two minutes, anonymous application/database readiness every ten minutes (HTTP 200 and JSON `configured: true`), and the public landing → fictional portfolio → funded-rebalance journey every two hours. Scheduling uses round-robin regions and at most one retry, within Hobby allowances. The account's trial automatically falls back to the $0 Hobby plan on October 28; no paid upgrade was selected. All three checks subscribe to the owner's existing email channel with failure and recovery events enabled. The test alert arrived at 20:17:25 UTC. A controlled failing assertion produced a failure email at 20:23:59 UTC; restoring the original name, HTTP 200, and JSON `true` produced a recovery email at 20:27:46 UTC. The final monitor returned to passing. No app outage, brokerage authorization, customer session, or private financial data was used for this drill.

This establishes private support and operational alerts for the limited beta. Production key recovery/Neon point-in-time restoration, SnapTrade production approval and consent branding, supported real-money brokerage verification, and a second external Personal identity remain separate launch requirements. The two recovery checks establish local logical restoration with synthetic data and a disposable key; they do not establish recovery of the production encryption key. See the [operations runbook](operations.md).

### Earlier combined interface release

The combined product and interface release was staged, checked, and promoted on October 14, 2026: deployment `dpl_5dkz2sQ5BKhJUTmuNqj2cXNW1KYg`, application commit `3e477f5`, Node.js 22. [Release CI passed](https://github.com/meetgojiya98/SnapTrade/actions/runs/38624124189): 195 unit/integration tests, 10 migration tests, and 38 Chromium tests, plus dependency advisory checks, type checking, and production build.

Staged verification confirmed database/schema readiness, the public guide and canonical URL, and anonymous portfolio rejection with no-store headers and safe error references. After promotion, the public landing, guide, and support returned successfully. The existing real Sandbox-authorized workspace loaded three accounts and its saved policy/history on the new deployment. Opening the retained historical plan confirmed its original USD 250 reserve, USD 5,000 reported cash, USD 4,750 planning base, and zero trades. No new brokerage grant, database migration, or credential rotation was needed for this release.

The two new backend failure regressions reproduce a delayed OAuth rejection after a newer successful rotation and a disconnect while a retry is pending. Six streamed-response tests verify byte limits, cancellation, multibyte decoding, rate limits, and mid-body failures. These are controlled protocol tests, rather than claims that those failures were forced against SnapTrade production.

### Earlier live integration evidence

Verified October 14, 2026 against deployment `dpl_HnNh4voiTSKfAx2pLjzvybTV9uGr`, application commit `5fbe98e`, and the dedicated Neon database. [CI passed](https://github.com/meetgojiya98/SnapTrade/actions/runs/38616983506): 184 unit/integration tests, 10 migration tests, and 36 Chromium tests, with type checking and production build.

| Live check                           | Observed result                                                                                                                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration and private boundaries | Complete runtime schema ready; anonymous portfolio, workspace, and history requests return 401 with no-store headers.                                                                           |
| Real OAuth                           | Personal test user approved only `openid read`; the HTTPS callback verified the ID token and opened a connected workspace.                                                                      |
| Cancelled consent                    | Returned a useful cancellation message and the private sign-in gate, with no sample substitution.                                                                                               |
| Actual Sandbox responses             | Loaded two self-directed accounts and one additional cash-only account. Stock prices and cash normalized; unsupported crypto/mutual-fund instruments remained blocking issues.                  |
| Real policy and plan persistence     | Saved a cash-only snapshot with USD 5,000 reported cash, USD 250 reserve, and zero proposed trades. Independent database inspection confirmed encrypted session, preference, and plan payloads. |
| Immutable historical policy          | Changed the current reserve to USD 500; the saved snapshot retained USD 250, its original source timestamp, and USD 4,750 planning base.                                                        |
| Historical CSV                       | Downloaded from the deployed app and verified original policy, saved/source timestamps, USD 5,000 cash, masked account identity, and historical/read-only labeling.                             |
| Disconnect                           | The real revocation response succeeded; local sessions and session cache became empty while preferences and plan history remained.                                                              |
| Return after redeployment            | Reauthorized on the new deployment; the selected cash account, USD 500 current reserve, and saved USD 250 historical policy returned from Neon.                                                 |

The database uses a restricted runtime role with CRUD access to application tables; migration/admin credentials are not deployed. Compute is capped at 0.25 CU and suspends after five idle minutes. The initial verification snapshot is retained in the Personal test workspace for inspection.

**Remaining release limits:** the configured OAuth app is Test-only (five users). Complete SnapTrade's production approval and register a Production OAuth app before public rollout. The consent name comes from the Commercial customer/workspace name. Real-money brokerage accounts and a second external Personal identity have not been tested. Nonzero rebalance scenarios, cross-user isolation, forced outages, deletion races, rate limits, and token-rotation races are covered by the automated suites rather than claimed as live Sandbox observations.

The cash-only Sandbox has no existing securities to buy, so zero trades is the correct result. Unsupported assets are not omitted to manufacture a plan. For a nonzero reviewer walkthrough, use the explicit sample workspace or a supported stock/ETF account.
