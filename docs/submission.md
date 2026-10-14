# Deployment and SnapTrade submission

BALANCE v2 implements the full product path: public explanation, explicit sample entry, private connection/loading states, reviewed workspace preferences, an account-funded simulation, and immutable saved history. **Real SnapTrade authorization and deployed persistence are still pending verification.** This guide separates setup from the evidence required for release.

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

For database-backed use, apply **all three migrations in order** through a provider SQL editor or a migration connection:

```sh
node --env-file=.env.local scripts/migrate.mjs
```

The runner applies the checked-in SQL in one transaction, records SHA-256 checksums, and serializes concurrent runs. Repeating it is safe; changing or removing an applied migration fails before any pending migration commits. It prefers `MIGRATION_DATABASE_URL`, then `DATABASE_URL_UNPOOLED`, then `DATABASE_URL`.

They create sessions/login attempts, workspace policies/plan history/deletion generations, and the portfolio snapshot cache. The runtime role needs `SELECT`, `INSERT`, `UPDATE`, and `DELETE` on those tables. The application does not automatically run migrations.

```sh
npm run dev
```

Open the exact `APP_URL` origin, then `/app` to sign in or `/demo` to explore. Restart after changing environment values. If using port 3001, update both `APP_URL` and the registered callback to that port.

## 3. Deploy the connected application

1. Provision hosted Postgres using the provider's required TLS settings and apply the three migrations above.
2. Link the repository to the `balance-snaptrade` Vercel project, or another compatible Node hosting environment. Configure Node.js 22, `npm ci`, and `npm run build` from the repository root.
3. Set `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CLIENT_SECRET`, `SESSION_ENCRYPTION_KEY`, `DATABASE_URL`, and `APP_URL` as server environment variables. For the existing public domain, use `APP_URL=https://balance-snaptrade.vercel.app` with no trailing slash. Production requires Postgres; the memory adapter is never a production option.
4. Register the exact HTTPS callback and redeploy after changing credentials, origin, or database configuration.
5. Open `/api/health` (process liveness), `/api/status` (configuration and complete database schema readiness), `/`, `/demo`, `/privacy`, and `/app` on the deployed domain, then complete the release checks below.

Keep credentials out of `NEXT_PUBLIC_*`, source control, and logs. Preserve the encryption key across deployments: sessions, policies, saved snapshots, and cached financial payloads depend on it. Separate production and preview databases/keys when they represent different environments. Use a migration role for table creation and a restricted runtime role for normal application access.

## 4. Run automated verification

Recorded local verification on October 14, 2026: **178 unit/integration tests and 10 migration tests**, including disposable real Postgres checks, plus **33 Chromium browser tests** with axe accessibility checks.

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

## Deployment verification status

The public project URL is [balance-snaptrade.vercel.app](https://balance-snaptrade.vercel.app), with the intended callback `https://balance-snaptrade.vercel.app/api/auth/callback`.

**Pending:** real Personal-user consent, actual brokerage-data normalization, and deployed session/preferences/history persistence. Update this section with dated evidence after completing those checks; do not infer them from the sample workspace or mocked browser suite.
