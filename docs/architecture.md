# How BALANCE works

## Product and routes

BALANCE answers a constrained allocation question: how close can an investor get to their target mix using the cash and whole shares available inside each brokerage account? It produces an explainable simulation, with no order submission or transfers.

| Route      | Experience                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------- |
| `/`        | Public product explanation, supported scope, and explicit entry choices.                      |
| `/app`     | Private connected workspace with authentication, loading, recovery, and empty-account states. |
| `/demo`    | Fixed sample data and browser-local sample preferences/history; no private API calls.         |
| `/privacy` | Data handling, retention, deletion, and connection controls.                                  |

A first connected visit asks the user to review targets, cash reserve, classifications, and account tax treatment, then save workspace preferences before planning. Subsequent changes have an explicit save action. Saved preferences include target weights, per-account reserve, minimum trade value, taxable-sale permission, account selection, and classification/type confirmations. Hypothetical contributions are scenario inputs and do not become a recurring policy.

A failed portfolio load never becomes a sample portfolio. Expired authorization clears private UI state and offers sign-in. An empty connected workspace links to SnapTrade Personal brokerage management and provides a return/reload action. Saved-history failures can be retried independently while current portfolio data remains usable. Request cancellation and session epochs prevent late responses from reopening private views after disconnect.

## Data flow and API

```text
/app → OAuth session → authenticated account reads → normalized portfolio
                  ↘ encrypted workspace preferences
normalized portfolio + preferences → pure planner → account-funded simulation
                                            ↘ server recalculation → immutable saved plan

/demo → fixed sample portfolio → same planner → browser-local sample history
```

The Next.js server owns OAuth exchanges and SnapTrade API requests. The browser receives display data and an opaque HttpOnly session cookie, never OAuth tokens or the client secret.

| Endpoint                 | Contract                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `GET /api/auth/login`    | Begin authorization with state, nonce, and PKCE.                                      |
| `GET /api/auth/callback` | Verify authorization and establish a session; return to `/app`.                       |
| `POST /api/auth/logout`  | Attempt token revocation and delete local credentials.                                |
| `GET /api/status`        | Environment readiness and whether this browser has an app session.                    |
| `GET /api/portfolio`     | Authenticated normalized portfolio, using the short server cache.                     |
| `GET /api/workspace`     | Saved policy for the verified subject, or defaults for a first visit.                 |
| `PUT /api/workspace`     | Validate and explicitly save `{ preferences }`.                                       |
| `DELETE /api/workspace`  | Delete saved preferences and plan history.                                            |
| `GET /api/plans`         | Historical summaries for this subject.                                                |
| `GET /api/plans?id=UUID` | One complete historical snapshot belonging to this subject.                           |
| `POST /api/plans`        | Validate scenario inputs, reload source data, recalculate, and save a named snapshot. |
| `DELETE /api/plans/UUID` | Delete an owned saved plan.                                                           |
| `GET /api/health`        | Minimal uncached service liveness.                                                    |

Private responses use `Cache-Control: no-store`. Mutations require the configured origin; workspace and plan mutations also reject cross-site Fetch Metadata and require bounded JSON input. Data ownership comes from the verified session subject, never a client-supplied user ID. An unknown owned plan returns 404 rather than exposing another user's record.

## Preferences and historical provenance

Connected preferences and plan payloads use AES-256-GCM encryption in Postgres with the server's `SESSION_ENCRYPTION_KEY`. Records are owned by the verified SnapTrade subject and indexed by its hash. Authenticated encryption binds ciphertext to its owner and record context. Policies and plans survive a new application instance when the database and encryption key remain consistent.

A saved plan contains its original selected account data, holdings, quantities, prices, issues, source sync timestamps, preferences, hypothetical contribution, calculated trades, funding result, and before/after drift. Its `asOf` is the oldest selected brokerage sync timestamp; creation time is recorded separately. A source fingerprint represents the actual source content and excludes mere retrieval time. Snapshots explicitly carry `historical: true` and `executable: false`.

Saving a connected plan reloads brokerage data and calculates on the server; it does not accept a browser-supplied result or reuse the display cache. Updated source data can therefore change the saved moves. A saved result is never refreshed in place. The detail view exposes its original policy and holdings, and historical CSVs retain the source timestamp and historical/read-only labeling.

The server enforces a limit of 30 plans per subject, including concurrent inserts across instances. Source snapshots are bounded to 2 MB, request bodies to 128 KB, and plan names to 80 characters. An owner deletion generation prevents an in-flight plan or preference save from restoring data after deletion.

The sample workspace stores only fictional data under `balance.demo.workspace.v1` in local storage, with a 25-plan cap. It validates stored preferences and snapshots before restoring them. Its values and valuation time use the fixed October 14, 2026 sample scenario, rather than appearing to be live market prices.

## Snapshot cache and freshness

`GET /api/portfolio` uses an encrypted **45-second cache per authenticated session**. PostgreSQL advisory locks coalesce simultaneous loads across instances. Ownership and the active session are verified on every read, including hits, and again around upstream fetches. `X-Snapshot-Cache` reports `hit` or `miss`; the HTTP response remains non-cacheable by browsers and intermediaries.

The cache reduces repeated SnapTrade reads. Its lifetime is independent of the brokerage snapshot age: fetching or caching a response does not make its holdings or cash current. A deleted workspace's generation invalidates prior cache entries and prevents pending fetches from restoring them. Anonymous or expired sessions cannot read cached data.

Normalization keeps the oldest positions/balance sync time. A selected snapshot older than 24 hours or more than five minutes in the future blocks a live plan. The interface checks freshness every 30 seconds and on focus/visibility changes; CSV export revalidates synchronously. Reloading retrieves the latest available data and does not force an upstream brokerage sync.

## Calculation contract

Every selected account is a separate funding pool. Purchases spend its own modeled cash, sales release cash into that same account, and whole-share proposed trades cannot borrow from another account. Taxable sales start disabled. Enabling them permits simulation of sales without calculating a tax liability.

Money uses integer cents. A holding's marked value is `round(quantity × priceCents)`. Cash-equivalent positions are excluded from holdings when already reflected in reported cash.

```text
gross value     = priced holdings + reported cash
investable base = gross value + hypothetical contribution
                  − reserve per account × selected account count
```

The contribution enters one selected account before both planning comparisons. The overview shows the actual portfolio without hypothetical cash. Its current allocation uses actual holdings plus cash; the simulation comparison uses the contribution-adjusted investable base and excludes protected reserves. Unspent investable cash can leave asset-class weights below 100%.

```text
class error = sum(abs(class value − target class value))
cash error  = abs(actual cash − total protected reserve)
drift (pp)  = 100 × (class error + cash error) / (2 × investable base)
```

Including unspent cash prevents the planner from appearing balanced just by selling holdings. Restoring an underfunded reserve is a hard constraint and may require permitted sales that increase drift. If the reserve cannot be funded, planning is blocked. Residual cash and drift remain visible when whole shares or other constraints prevent a closer match.

After reserve restoration, the heuristic evaluates moves and sale/buy pairs inside accounts and accepts strict objective improvements. Work is bounded at 160 iterations and 250,000 evaluations. Results are deterministic for the same inputs; global optimality is not guaranteed.

## Supported data and assumptions

Live planning supports USD stock/ETF accounts. Automatic classifications cover US-equity ETFs `VTI`, `VOO`, `IVV`, `SPY`; international ETFs `VXUS`, `VEA`, `VWO`; bond ETFs `BND`, `AGG`; and stocks `AAPL`, `MSFT`, `NVDA`. Other holdings and unknown account tax treatment require explicit user confirmation. Saving those confirmations preserves them by account/instrument identity; they remain user assumptions.

Confirmations remove only the classification or tax-treatment issues they resolve. Missing prices, quantities, currency mismatches, stale data, unsupported instruments, disabled connections, reconciliation problems, and other issues continue to block planning. Holdings without stable instrument IDs cannot be safely confirmed. Options, shorts, ambiguous/duplicate symbols, inconsistent same-symbol prices, negative cash, and unsupported currencies are rejected. Fractional existing holdings are valued, but proposed changes use whole shares and respect the minimum trade value.

The planner buys only classified eligible securities already held in each account. A cash-only account or missing asset class does not imply permission to invent a new investment selection. Accounts can be selected separately to inspect supported subsets; cash and currencies never silently cross boundaries.

SnapTrade account data is read with Bearer authentication through `/accounts/all`, `/authorizations`, account positions, and balances. Account fan-out is bounded and more than 100 returned accounts is rejected. A successful API response does not establish freshness or a healthy connection. Rate limits and incomplete records remain recoverable issues. See the official [account-data](https://docs.snaptrade.com/docs/account-data), [freshness](https://docs.snaptrade.com/docs/syncing), and [OAuth](https://docs.snaptrade.com/docs/oauth-apps) documentation.

## Security and data lifecycle

Authorization uses code flow with PKCE `S256`, browser-bound state, and an OIDC nonce. `jose` verifies ID-token signature, issuer, audience, expiry, and nonce against discovered signing keys. The app requests `openid read`; it does not request email or trading access.

Production Postgres stores encrypted login state, sessions, preferences, plans, and cached financial data using `SESSION_ENCRYPTION_KEY`. Login attempts expire after ten minutes and app sessions after seven days. Refresh-token replacement is serialized under the session row lock across instances. Login state is consumed atomically; a failed authenticated API call can refresh/retry once before requiring authorization again. In-memory adapters are explicit development conveniences and disappear on restart.

Deleting a plan removes that historical record. Deleting workspace data removes saved preferences and all plans, invalidates cached snapshots, and retains a non-financial hashed-owner generation marker for race protection. It leaves the SnapTrade connection active. Disconnect attempts remote revocation and deletes local credentials; saved preferences/history remain available after fresh authorization by the same subject. Failed revocation produces a recovery instruction to remove the app in SnapTrade Personal.

Keep the encryption key stable across deploys; replacing it makes existing ciphertext unreadable. Never put credentials in `NEXT_PUBLIC_*`, browser storage, or logs. Apply all migrations before database-backed use. The [privacy page](https://balance-snaptrade.vercel.app/privacy) describes the user-facing controls.

## Verification boundaries

Local verification covers 178 unit/integration tests and 10 migration tests, including disposable real Postgres checks, and 33 Chromium tests. Browser tests exercise simulated connected responses, historical provenance, persistence, recovery, mobile layout, and axe WCAG A/AA checks. These checks establish the implemented contracts within their test environments.

Real consent, actual brokerage responses, and deployed persistence remain pending verification. Follow the [release walkthrough](submission.md) with registered OAuth credentials, a Personal test user, and the production database before making those claims. Fees, taxes, settlement, execution, FX, margin, and investment outcomes remain outside this simulator's contract.
