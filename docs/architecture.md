# How BALANCE works

## The product decision

An allocation percentage is easy to calculate. A feasible change across several accounts is harder: cash is local to an account, shares are discrete, and selling in a taxable account has consequences a percentage alone cannot express.

BALANCE focuses on that decision. It creates a read-only rebalancing simulation with visible constraints and an explanation a reviewer can follow. It deliberately keeps trading execution outside the scope.

## Data flow

```text
Browser
  ├─ sample portfolio ──────────────────────┐
  └─ SnapTrade OAuth → server session       │
                          ↓                │
                SnapTrade account API      │
                          ↓                │
                  normalized portfolio ←───┘
                          ↓
                pure rebalance planner
                          ↓
          allocation + per-account simulation
```

The Next.js server owns OAuth exchanges and authenticated SnapTrade requests. The browser receives the portfolio data needed for the interface, never OAuth access tokens, refresh tokens, or the client secret. Sample and connected portfolios enter the same calculation layer so the sample experience exercises the product's real planner.

## HTTP surface

| Route                | Purpose                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `/api/auth/login`    | Begin SnapTrade authorization with a fresh state, nonce, and PKCE challenge.                                    |
| `/api/auth/callback` | Validate the authorization response, exchange the code, verify identity, and establish the application session. |
| `/api/auth/logout`   | Disconnect the session and revoke stored SnapTrade access through the server.                                   |
| `/api/portfolio`     | Read connected account data through the server and return the normalized portfolio.                             |
| `/api/status`        | Report whether the environment is configured for the connection experience.                                     |

The callback registered with SnapTrade must equal `APP_URL` followed by `/api/auth/callback`. Redirect matching includes the scheme, hostname, port, path, and trailing slash.

## The calculation contract

The planner treats each selected account as a separate funding pool. It computes target values from the selected portfolio, proposes whole-share changes, and evaluates the resulting allocation. Purchases consume that account's available modeled cash; sales release modeled cash into that same account. A plan cannot use one account's surplus cash to fund another account's purchases.

All monetary arithmetic uses integer cents. For each non-cash-equivalent position, the marked value is `round(quantity × priceCents)`. The gross portfolio value is the sum of those marked holdings and reported cash. Cash-equivalent positions are excluded because their value is already reflected in reported cash.

The target denominator is:

```text
investable base = gross value + hypothetical contribution
                  − cash reserve per account × selected account count
```

The hypothetical contribution enters one selected account before both the before and after snapshots. Both snapshots use that same contribution-adjusted investable base. The overview's gross value describes the actual portfolio and excludes hypothetical new cash. Class percentages can sum to less than 100% because unspent investable cash remains.

Drift includes that cash rather than allowing a portfolio to appear balanced simply by selling its holdings:

```text
total reserve = cash reserve per account × selected account count
class error   = sum(abs(class value − target class value))
cash error    = abs(actual cash − total reserve)
drift (pp)    = 100 × (class error + cash error) / (2 × investable base)
```

Actual cash remaining includes the protected reserve; unspent investable cash is the amount above that reserve. Restoring an underfunded reserve is a hard constraint and may require permitted sales that increase drift. When the reserve cannot be funded within the allowed actions, planning is blocked.

Taxable-account sales are an explicit opt-in. Enabling them changes what the simulation is allowed to propose; it does not calculate a tax liability. The simulator never submits the proposed changes to a brokerage.

Currencies remain separate. There is no implicit dollar equivalence, estimated exchange rate, or assumed FX trade. The live integration currently supports only USD accounts and automatically classifies an explicit set of securities: US-equity ETFs `VTI`, `VOO`, `IVV`, `SPY`; international ETFs `VXUS`, `VEA`, `VWO`; bond ETFs `BND`, `AGG`; and US stocks `AAPL`, `MSFT`, `NVDA`. An unsupported or unclassified holding blocks that account's plan rather than disappearing from the result. The planner can buy only classified securities already present in each account; it does not invent a new fund selection.

For other stock and ETF symbols, the user can review the underlying assets and explicitly classify them as US equities, international equities, or bonds. Unknown account tax treatment also requires confirmation. The review dialog asks the user to acknowledge those choices before applying them. These are user-supplied assumptions, not classifications verified by the app. They exist only in the current page's state and clear on reload. The helper removes only the exact classification or tax-treatment issues resolved by those choices; missing prices, stale snapshots, currency mismatches, reconciliation errors, and unsupported instruments continue to block planning.

Any account issue blocks planning for the selected set. Missing or invalid prices, cash, quantities, or freshness also block. Snapshots older than 24 hours or more than five minutes in the future are rejected. The interface reevaluates freshness every 30 seconds and on focus or visibility changes; export also revalidates synchronously before creating a file. Blank constraints remain invalid until the user supplies an explicit value. Short positions, duplicate or ambiguous tradable symbols within one account, inconsistent same-symbol mappings or prices, and mixed account/position currencies are unsupported. Fractional existing holdings are valued, but proposed trades use whole shares. The minimum trade value applies to each proposed move.

Whole-share constraints naturally leave cash and allocation drift. The result exposes those residuals. A zero-dollar balance or a zero-share holding is valid input and is different from an unavailable value.

The planner is a heuristic. After reserve restoration, it evaluates moves and sale/buy pairs inside an account, accepting strict improvements to its objective. Work is bounded at 160 iterations and 250,000 evaluations. Its priority is a feasible, deterministic, understandable plan. It does not solve a global mixed-integer optimization problem, and it does not guarantee the smallest possible tracking error for every combination of accounts and securities.

## SnapTrade data boundaries

The application uses canonical SnapTrade API paths with Bearer authentication. OAuth requests do not need Commercial API-key signatures or user secrets. The current all-positions endpoint returns instrument-specific records and freshness information; positions and cash balances must be normalized before they enter the planner. See the [all-positions reference](https://docs.snaptrade.com/reference/Account%20Information/AccountInformation_getAllAccountPositions).

Cash-equivalent positions may already be counted in a reported cash balance. They need explicit treatment to prevent double counting. Option contracts and other instruments also need their own valuation rules; multiplying all position units by a stock-style price is not a universal valuation method.

Account values, positions, balances, and prices may arrive with different freshness. A successful API response is not proof that the brokerage data is current. A disabled connection may return its last cached state. Holdings freshness and the time the app fetched a response are distinct concepts. SnapTrade transaction history is daily data and can lag intraday activity; it is not a live execution feed. These constraints are documented in [account data](https://docs.snaptrade.com/docs/account-data) and [syncing](https://docs.snaptrade.com/docs/syncing).

Rate limiting can apply across account-data endpoints for one account. Handle a `429` as a temporary limitation and preserve a clear retry path. OAuth callers should honor `Retry-After`; do not assume customer-level quota headers are available. Current behavior is described by the [OpenAPI specification](https://docs.snaptrade.com/openapi.yaml) and [rate-limit guide](https://docs.snaptrade.com/docs/ratelimiting).

## Session and OAuth security

The integration uses authorization code flow with PKCE `S256`, plus state to bind a callback to the initiating browser session. OpenID Connect identity is verified against SnapTrade's signing keys, issuer, audience, expiry, and authorization nonce before it is trusted. The application does not derive identity by merely decoding a JWT.

Tokens and authorization state belong on the server. Production stores session data encrypted with AES-256-GCM in Postgres using a separately configured `SESSION_ENCRYPTION_KEY`; the browser holds an opaque session cookie, and the database stores its hash. Login attempts expire after ten minutes, and application sessions expire after seven days. Apply `migrations/001_sessions.sql` before database-backed login. In-memory sessions are an explicit development convenience (`SESSION_STORE=memory` with no `DATABASE_URL`) and disappear when the process restarts. They are unsuitable for production instances or serverless workers.

Refresh tokens rotate. The Postgres store takes a row lock around a session's refresh request and token replacement, so concurrent requests across app instances serialize against that session. OAuth login state is consumed with a single database delete-and-return operation to prevent callback replay. A failed authenticated API call may refresh and retry once; repeated authentication failure requires fresh authorization. Disconnect attempts remote revocation and deletes local credentials. If revocation cannot be confirmed, the API returns a warning directing the user to remove the app in the SnapTrade Dashboard. Secrets, authorization codes, and tokens must not appear in application logs or client responses.

For the authoritative protocol details, see [SnapTrade's OAuth guide](https://docs.snaptrade.com/docs/oauth-apps). The required scopes are limited to the account data and sign-in behavior this application uses; trading permission is unnecessary.

## What the simulation does not model

- Brokerage commissions, exchange fees, slippage, bid/ask spreads, or price movement between data fetch and execution.
- Tax basis, realized capital gains, wash-sale rules, account contribution limits, or jurisdiction-specific tax treatment.
- Settlement timing, unsettled cash, margin borrowing, broker-specific order minimums, or all buying-power restrictions.
- Fractional-share execution, options strategies, FX conversion, or cross-account transfers.
- A guaranteed globally optimal allocation or future investment performance.

The user can inspect a planning result, then decide what to do in their brokerage. Data access and calculation are distinct from execution.

## Verification boundaries

Planner tests should establish feasibility and meaningful edge cases: cash conservation, integer quantities, taxable-sale protection, insufficient cash, currency boundaries, and deterministic results. Server tests should exercise the actual implemented authentication and data contracts. A production build verifies TypeScript and Next.js packaging.

Live verification is a separate step. It requires registered OAuth credentials, a Personal test user with connected accounts, a public callback when deployed, and a working production database. Test login, denial, disconnect, session persistence, empty portfolios, and data errors in that environment. A sample portfolio or mocked OAuth response cannot establish those properties.

The [submission walkthrough](submission.md) records the checks to perform and the questions a reviewer can use to inspect the implementation.
