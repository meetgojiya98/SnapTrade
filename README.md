# BALANCE

**A clearer way to rebalance a portfolio spread across brokerage accounts.**

BALANCE connects to SnapTrade with read-only OAuth and turns a target allocation into an explainable, account-by-account simulation. It answers a practical question: “How close can I get to my allocation with the cash and whole shares I actually have?”

The difficult part is respecting the boundaries real portfolios have. Cash belongs to a particular account. A taxable sale needs an explicit choice. Different currencies cannot be added without an exchange rate. Prices and connections can be stale. BALANCE makes those constraints visible alongside its result.

Built for the [SnapTrade Product Engineer application](https://careers.snaptrade.com/product-engineer).

![Balance portfolio workspace](docs/images/portfolio.png)

## Try it locally

Requires Node.js 22 and npm.

```sh
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The sample portfolio lets you explore the simulator before configuring SnapTrade. Sample data is explicitly identified; it is separate from connected account data.

If port 3000 is occupied, use `npm run dev -- --port 3001`. For OAuth on that port, update `APP_URL` and register the matching callback in SnapTrade.

To connect real or SnapTrade Sandbox accounts, configure the OAuth credentials and session encryption key described below. OAuth setup, live account verification, and public deployment require your own SnapTrade workspace and hosting configuration.

## What it does

- Combines account positions into an allocation view while keeping cash and proposed trades tied to their source account.
- Models whole-share purchases and sales against editable allocation targets.
- Keeps taxable sales disabled until you enable them.
- Shows the allocation before and after the simulation, residual cash, and an account-level explanation of the proposed changes.
- Keeps currencies separate; it does not invent FX conversions or move cash between accounts.
- Uses SnapTrade for account data. It does not request trading permission or submit orders.

This is a planning tool. The planner is a deterministic heuristic, rather than a guarantee of the globally best allocation. Live planning supports USD accounts, with automatic classification for an explicit set of stocks and ETFs and a review step for other assets or unknown account tax treatment. User-confirmed categories clear on reload; incomplete data and unsupported instruments continue to block planning. Brokerage fees, realized taxes, settlement, margin, and execution prices are not modeled. See [the calculation and data boundaries](docs/architecture.md).

## Connect SnapTrade

The application uses **SnapTrade OAuth**, rather than Commercial API-key authentication. The workspace that owns the OAuth app and the Personal workspace authorizing account access serve different purposes.

1. Create a **Commercial** account/workspace in the [SnapTrade Dashboard](https://dashboard.snaptrade.com). Under **OAuth Apps**, register a **Test** app.
2. Register this exact local redirect URI:

   ```text
   http://localhost:3000/api/auth/callback
   ```

3. Save the app's client ID and client secret in `.env.local` as `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CLIENT_SECRET`. The secret is shown once. These are OAuth app credentials, not a Commercial API `clientId`/`consumerKey` pair.
4. Generate a session encryption key:

   ```sh
   openssl rand -base64 32
   ```

   Save the output as `SESSION_ENCRYPTION_KEY`. Keep `APP_URL=http://localhost:3000` for this callback.

5. In a **Personal** SnapTrade account/workspace, connect a brokerage. For testing, choose SnapTrade **Sandbox** with its self-directed scenario. This is the user who will consent to BALANCE's access; creating the Commercial OAuth app does not create this brokerage connection.
6. Restart the dev server after changing environment variables. Choose the app's SnapTrade connection action, sign in as the Personal test user, and grant the requested read access.

SnapTrade Test OAuth apps allow up to five users. Production OAuth app registration requires SnapTrade's production approval. Follow the [official OAuth guide](https://docs.snaptrade.com/docs/oauth-apps) for the current setup and approval process, and the [Sandbox guide](https://docs.snaptrade.com/docs/sandbox) for test scenarios.

For public hosting, register `https://YOUR_DOMAIN/api/auth/callback`, set `APP_URL` to that exact HTTPS origin, configure a Postgres `DATABASE_URL`, and apply `migrations/001_sessions.sql`. Development can explicitly use `SESSION_STORE=memory` with no database; production requires durable storage. Full instructions are in [deployment and submission](docs/submission.md).

## Verify

Validated locally on October 14, 2026: **97 unit and integration tests**, including a disposable real PostgreSQL database; **25 Chromium browser tests**; TypeScript; and the production build. The real SnapTrade consent flow remains pending credentials.

```sh
npm test
npm run build
```

Run the Chromium browser checks with:

```sh
npx playwright install chromium
npm run test:e2e
```

The browser suite starts or reuses a development server at `http://127.0.0.1:3001`. `PLAYWRIGHT_BASE_URL` can target an already running instance. It exercises the sample experience and connection setup with a controlled status response; it does not perform real SnapTrade authorization.

GitHub Actions runs type checking, unit and disposable Postgres tests, a production build, and the Chromium suite on pushes and pull requests. Set `CAPTURE_SCREENSHOTS=1` when running the existing browser tests to save the portfolio and rebalance views under `docs/images/`.

Automated verification covers the implemented planner and server behaviors exercised by the test suite. A production build checks compilation and application packaging. Neither proves that OAuth consent, a particular brokerage, or a deployed database works: run the [live verification walkthrough](docs/submission.md) with your configured environment before submitting the project.

## Read further

- [Architecture, calculation rules, and security](docs/architecture.md)
- [Deployment, live verification, and reviewer walkthrough](docs/submission.md)
- [SnapTrade's current OAuth documentation](https://docs.snaptrade.com/docs/oauth-apps)
- [SnapTrade account-data concepts](https://docs.snaptrade.com/docs/account-data) and [data freshness](https://docs.snaptrade.com/docs/syncing)

## Stack

Next.js with TypeScript, Node.js 22, and Postgres for encrypted production sessions. The portfolio planner is a pure calculation layer, separate from the SnapTrade integration and interface.
