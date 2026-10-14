# Deployment and SnapTrade submission

The SnapTrade brief asks for a working, publicly hosted OAuth application and a project selected from a Commercial workspace. This repository provides the application. You must still register the OAuth app, configure its credentials, deploy it, and verify the live integration before representing it as ready for review.

## 1. Register the app and a test user

Create a Commercial account/workspace in the [SnapTrade Dashboard](https://dashboard.snaptrade.com). Select **OAuth Apps**, create a **Test** app, and save its client ID and client secret. The secret is shown only once. The application requests `openid read`; configure these scopes according to the [official OAuth guide](https://docs.snaptrade.com/docs/oauth-apps).

Add these redirect URIs as needed:

```text
http://localhost:3000/api/auth/callback
https://YOUR_DOMAIN/api/auth/callback
```

Use the stable production domain for the deployed callback. A deployment preview URL only works if its exact callback is separately registered and its `APP_URL` matches. Avoid changing the registered URL on every preview build.

Separately, use a **Personal** SnapTrade account/workspace as the user consenting to data access. Connect SnapTrade **Sandbox** there and select the self-directed scenario to exercise funded accounts, holdings, and cash. The Commercial workspace owns the OAuth app; the Personal workspace owns the accounts shared with it. Both roles are needed even if the same person manages them.

Test OAuth apps are limited to five users. A Production OAuth app requires SnapTrade production approval. Sandbox is read-only and supports scenarios such as cash only, no transactions, and no accounts. See the [Sandbox documentation](https://docs.snaptrade.com/docs/sandbox).

## 2. Configure local development

Install Node.js 22, then run:

```sh
npm install
cp .env.example .env.local
openssl rand -base64 32
```

Paste the generated key and OAuth credentials into `.env.local`:

```dotenv
SNAPTRADE_CLIENT_ID=your-oauth-client-id
SNAPTRADE_CLIENT_SECRET=your-oauth-client-secret
APP_URL=http://localhost:3000
SESSION_ENCRYPTION_KEY=your-base64-encoded-32-byte-key
DATABASE_URL=your-postgres-connection-string
SESSION_STORE=memory
```

For local development without Postgres, leave `DATABASE_URL` empty and explicitly set `SESSION_STORE=memory`. If `DATABASE_URL` is populated, it takes precedence over the memory setting. Use Postgres locally when testing persistence. Apply `migrations/001_sessions.sql` through the provider's SQL editor or a direct migration connection before login; the application does not create its own tables. Keep `.env.local` out of version control. Restart the server after changing environment variables.

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), connect with SnapTrade, and authorize as the Personal user.

## 3. Deploy publicly

Vercel is one supported option named in the [application brief](https://careers.snaptrade.com/product-engineer). The app also needs a durable Postgres database; a free hosting tier does not remove that requirement.

1. Create a hosted Postgres database and copy its connection string. Use the database provider's required TLS settings. Apply the SQL in `migrations/001_sessions.sql` through the provider's SQL editor or a direct Postgres connection with permission to create the tables and indexes. For example, with `psql` installed and the migration connection in `DATABASE_URL`, run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/001_sessions.sql`. The application does not run this migration automatically. Its runtime role needs `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges on `balance_oauth_attempts` and `balance_sessions`.
2. Import this GitHub repository into a new Vercel project. Select the Next.js framework preset and Node.js **22.x**. Use the repository root, `npm install` as the install command, and `npm run build` as the build command. Keep the `package.json` Node engine aligned with this major version; Vercel's [Node version rules](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions) allow a loose engine range to override the dashboard selection.
3. Configure the five environment variables above in the hosting dashboard. Set `APP_URL` to the stable HTTPS production origin, with no trailing slash. Set `DATABASE_URL` to the hosted database, and generate a fresh production encryption key.
4. Deploy. In the SnapTrade OAuth app settings, register the exact `APP_URL` plus `/api/auth/callback`.
5. If a domain or environment variable changes, redeploy and update the registered callback together. A production application must have the credentials, encryption key, and durable database configured.
6. Run the live checks below using the public URL.

Keep OAuth credentials and database access in server environment variables. Do not prefix these names with `NEXT_PUBLIC_`. Preserve the encryption key across deploys; changing it makes existing encrypted sessions unreadable and users will need to sign in again.

Use one database and key consistently for all instances of an environment. Production and preview environments should use distinct credentials, session keys, and databases when they represent separate OAuth apps or test populations.

## 4. Verify the deployed experience

Run the repository checks first:

```sh
npm test
npm run build
```

The browser suite covers the sample experience, constraint changes, blocked data scenarios, setup dialogs, and mobile layout. Run `npx playwright install chromium` once, then `npm run test:e2e`. It uses port 3001 by default, starts or reuses a development server, and controls `/api/status` to keep sample flows independent of local credentials. It does not verify the external OAuth consent flow.

An optional Postgres integration suite exercises durable session behavior across independent connections. With a disposable loopback Postgres database whose name begins with `balance_test`, run `TEST_DATABASE_URL=postgres://USER:PASSWORD@127.0.0.1:5432/balance_test_sessions npx vitest run src/lib/server/store.postgres.test.ts`. The suite rejects remote hosts and other database names; keep this database separate from production sessions.

Then verify these behaviors in the deployed application:

| Check                | What to establish                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sample walkthrough   | A reviewer can use the sample portfolio without credentials and can identify it as sample data.                                                                                                                                   |
| OAuth connection     | Authorization goes to SnapTrade, returns to the registered HTTPS callback, and loads the Personal user's shared accounts.                                                                                                         |
| Denied consent       | Denying access returns a useful recoverable state without creating an authenticated portfolio session.                                                                                                                            |
| Account coverage     | Multiple accounts retain their names, currencies, cash, holdings, and data limitations.                                                                                                                                           |
| Feasible simulation  | Whole-share proposed purchases fit the modeled cash of their own account; no cash silently crosses accounts.                                                                                                                      |
| Taxable sales        | A taxable sale appears only after its explicit opt-in is enabled.                                                                                                                                                                 |
| Empty data           | Cash-only and no-account scenarios do not invent holdings or crash.                                                                                                                                                               |
| Explicit assumptions | Unclassified assets and unknown tax treatment require user review and acknowledgment; classifications clear on reload and cannot override missing prices, stale snapshots, or other data errors.                                  |
| Persistence          | A signed-in session survives a new app instance or redeploy against the same database and encryption key.                                                                                                                         |
| Disconnect           | Disconnect clears local access and attempts remote revocation. An unconfirmed revocation displays the recovery instruction to remove the app in the SnapTrade Dashboard. Returning to the portfolio requires fresh authorization. |
| Data failure         | Expired authorization and unavailable account data produce a recovery path rather than a fabricated successful result.                                                                                                            |
| Privacy              | Client responses and browser storage contain no OAuth secret, access token, refresh token, or database credential.                                                                                                                |

Test token refresh and error paths with a controlled test environment when ordinary interactive testing cannot reliably force them. Automated tests and a successful build do not substitute for the real OAuth round trip.

## 5. Reviewer walkthrough

A useful five-minute demonstration:

1. Open the sample portfolio. Explain why a portfolio-wide target does not make all cash available to every account.
2. Edit allocation targets and run a simulation. Inspect the before/after allocation, whole-share changes, residual cash, and per-account funding.
3. Toggle taxable sales and rerun the same scenario. Explain which new actions become possible and why a tax calculation is outside this result.
4. Inspect a constraint or data limitation. Explain the treatment of currencies, stale prices, and unsupported instruments.
5. Connect SnapTrade with a Personal Sandbox user. Show that the same planner works with normalized API data, then disconnect.

Suggested deep-dive questions:

- Where are the planner's feasibility invariants enforced, and which tests would detect a violation?
- Can this heuristic fail to find a better feasible allocation? What would an integer optimizer change?
- How does the integration prevent cash-equivalent double counting and cross-account cash movement?
- How are missing prices and mixed currencies represented without a misleading total?
- How are state, PKCE, nonce verification, encrypted storage, and refresh rotation implemented?
- What happens when two server instances refresh the same session, a brokerage is stale, or a request is rate-limited?
- What would be required to add execution, fees, settlement, or tax-sensitive optimization responsibly?

## 6. Submit

After the public OAuth flow is verified, open the [Product Engineer application](https://careers.snaptrade.com/product-engineer), sign in with SnapTrade, choose the Commercial project associated with this app, provide its public URL, and add a LinkedIn URL or résumé.

The repository does not submit an application on your behalf. Include a short, candid description of the implemented scope and remaining limitations, and be ready to explain the code and product choices.

Suggested project description:

> BALANCE is a read-only portfolio rebalancing simulator for investors with multiple brokerage accounts. It turns target allocations into whole-share, account-funded plans, keeps taxable sales behind an explicit choice, and makes residual cash and data limitations visible. SnapTrade OAuth provides the account data; proposed changes remain simulations. The planner favors feasible, explainable results and does not model fees, realized taxes, settlement, FX conversion, or a globally optimal allocation.
