# Operating Balance

Balance is a read-only planning beta. An operator must be available before private support starts accepting requests. Wider connected access requires SnapTrade production approval and real brokerage verification.

## Private support

Customers use `/support/inbox` with their existing SnapTrade identity. They can create a request, read and send replies, resolve/reopen, and delete one or all of their own conversations. Workspace deletion and disconnect are separate from support deletion. No portfolio snapshot, email address, or attachment is sent automatically. Replies stay inside the inbox; there are no email notifications or response-time promises.

The server-only `SUPPORT_ADMIN_SUBJECT_HASHES` contains a comma-separated allowlist of at most 20 valid SHA-256 hex values. Empty or malformed configuration grants nobody access and disables new requests. Customers can still read and delete earlier requests.

To authorize an operator:

1. Have the intended person sign into Balance and open **Private support → Operator setup**. Verify the human controlling that sign-in through a trusted channel.
2. Obtain their own displayed setup key: `SHA256("balance:subject:" + verified SnapTrade subject)`. The server derives identity from its authenticated session; a key in an API body never grants access.
3. Review the grant: operators can read/reply to every support conversation and change its status. They cannot delete another customer's conversation or obtain brokerage credentials through support.
4. Add the key to the Vercel production allowlist, preserving existing authorized operators. Use stdin or a private file and deploy. Verify the operator queue with the intended account and rejection with a customer account.
5. Remove a departed operator and redeploy. Privilege is checked on every request. Do not share a Personal sign-in as a substitute for individual access.

Start with open cases whose last message came from a customer. Reproduce problems with non-sensitive fixtures. Ask for an error reference rather than credentials or full account numbers. Reply inside the case; keep sensitive content out of GitHub issues.

Transactional limits apply across instances: 20 conversations per customer, 50 messages per conversation, 100 title characters, 4,000 message characters, three new conversations per hour, and 30 customer/120 operator writes per hour. Create/reply retries use a stable UUID. Reusing a UUID with different content is rejected. Deletion markers and owner generations prevent delayed retries from restoring deleted cases.

Content and summaries are encrypted with owner/record context. Conversations expire 180 days after last activity: reads hide them immediately and bounded cleanup removes expired content as support is used. Hashed request-deletion markers expire after 180 days; non-content actor generation/rate counters remain for deletion-race protection. Deletion removes active content, while the provider may retain encrypted copies in its restore history.

## Readiness and incidents

- `/api/health`: uncached process liveness only.
- `/api/status`: configuration and complete database/schema readiness; it does not prove upstream brokerage freshness.
- Public pages and the sample workspace remain independent of private service availability.

For an incident, record the error reference and time, then correlate it with Vercel's bounded `balance.request.failed` event. Never add tokens, authorization codes, source errors, account IDs, holdings, request bodies, or support messages to logs. Check readiness before diagnosing a customer's brokerage connection. An outage must produce an honest retry path.

If a release causes a regression, promote a previously verified **balance-snaptrade** deployment. Keep the database and encryption key stable. Additive schema migrations can remain while application code rolls back; do not modify applied migration files or run destructive rollback SQL.

External monitoring uses Checkly, configured separately from application deployments. The account's trial automatically falls back to the $0 Hobby plan; do not upgrade or enable paid overages without approval. Keep checks within its hard caps: one public URL monitor, an anonymous readiness check every ten minutes, and the [public browser journey](../monitoring/README.md) every two hours, with round-robin regions and at most one retry. Subscribe the owner's approved channel to failure and recovery. Verify actual delivery and record it in the release evidence before relying on alerts. Manual checks and CI are not continuous monitoring. Monitor readiness separately from liveness, tolerating cold starts. Authenticated monitoring needs a dedicated authorized test identity, never a customer's cookie; no private brokerage or support data is sent to Checkly.

Failure and recovery email delivery were both verified on October 14, 2026 with a controlled readiness-monitor assertion, then the original HTTP 200 / JSON `configured: true` contract was restored. The monitor returned to passing. The [dated release evidence](submission.md#private-support-and-operations-release--october-14-2026) records exact times and boundaries. Repeat this drill when changing alert destinations or escalation settings; label it clearly, restore the normal assertion in the same session, and verify recovery before finishing.

## Migrations

The runtime role has CRUD rights to application tables and no schema, database, or role creation. Administrative direct connections are used only for migrations/grants, never production runtime configuration.

1. Create an expiring temporary Neon child branch of the intended production branch with minimum compute. Save its connection separately; do not overwrite application environments.
2. Run `npm run db:migrate` using its `MIGRATION_DATABASE_URL`, then repeat to verify idempotence. The runner validates ordered checksums under an advisory lock.
3. Verify schema, restricted runtime privileges, and preservation of existing row counts. Never run disposable tests against production or a branch containing customer records.
4. Apply the unchanged migration to production and grant CRUD only on new application tables to `balance_runtime`. Verify readiness with that role.
5. Stage the exact application commit without moving the public alias, run CI/smoke checks, promote, and verify. Delete the temporary branch after verification.

## Backup and recovery

On October 14, 2026, Neon project `balance-production` reported `history_retention_seconds: 86400` (24 hours). Recheck before relying on it; this is not a recovery rehearsal or long-term archive.

Encrypted records require the matching `SESSION_ENCRYPTION_KEY`. The production key is a Vercel Secret and cannot be read back through an environment pull. **Do not rotate it to create a backup:** existing records would become unreadable. Before storing real customer financial records, establish operator-controlled recovery of the original key and rehearse provider recovery into an isolated environment. Do not add a key-export endpoint, print secrets, or commit them.

The local logical restore drill creates fresh loopback databases, synthetic records, and a disposable key. It dumps/restores those databases and checks application reads, isolation, ciphertext integrity, and failure with a wrong key. It does not prove Neon point-in-time restore or recovery of the production key. Use the explicit command and safeguards in the verification instructions.

During provider recovery, preserve the failed database, choose a point within the verified restore window, restore into an isolated branch, and validate schema, ciphertext, ownership, and application behavior before redirecting traffic. Recheck recent deletions before exposing restored records. Record the recovery point, data-loss interval, and restoration time; do not silently expose an unverified restore.
