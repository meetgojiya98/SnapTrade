import Link from 'next/link';
import type { Metadata } from 'next';
import styles from '../landing.module.css';
export const metadata: Metadata = { title: 'Privacy & your data — Balance' };
export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logo} href="/">
          balance.
        </Link>
        <Link className={styles.headerCta} href="/app">
          Open workspace
        </Link>
      </header>
      <main className={styles.policy}>
        <span className={styles.eyebrow}>PRIVACY & YOUR DATA</span>
        <h1>Your portfolio is personal.</h1>
        <p className={styles.policyLead}>
          This page explains what Balance stores, why it needs it, and the controls available to
          you. Last updated October 14, 2026.
        </p>
        <section>
          <h2>What you share</h2>
          <p>
            When you authorize Balance through SnapTrade, the app receives your verified SnapTrade
            user identifier and permission to read your shared accounts, positions, cash balances,
            and connection status. It does not request trading permission, your email address, or
            your brokerage password.
          </p>
        </section>
        <section>
          <h2>What is stored</h2>
          <p>
            The server stores encrypted OAuth credentials so you can stay connected. It also stores
            your allocation targets, constraints, classification confirmations, and any plans you
            choose to save. A saved plan includes the account snapshot used to calculate it.
            Financial payloads are encrypted at rest, associated with your verified SnapTrade
            identity, and accessed through authenticated server routes.
          </p>
          <p>
            The browser receives portfolio data for display and holds an opaque, HttpOnly session
            cookie. OAuth tokens are never placed in browser storage. The explicit sample workspace
            uses fictional data and keeps its preferences and sample plans in this browser’s local
            storage.
          </p>
        </section>
        <section>
          <h2>Sessions, snapshots, and saved plans</h2>
          <p>
            App sessions expire after seven days and login attempts after ten minutes. Cached
            account snapshots are temporary and are not used as proof of fresh prices. Saved plans
            are retained until you delete them or delete your saved workspace data, with a limit of
            30 plans per workspace.
          </p>
        </section>
        <section>
          <h2>Your controls</h2>
          <p>
            In your workspace, you can delete individual saved plans or delete all saved workspace
            data. Deleting workspace data removes saved targets, confirmations, and plans.
            Disconnecting SnapTrade attempts to revoke the OAuth grant and deletes the local
            connection credentials; it does not silently delete your saved plans.
          </p>
          <p>
            If SnapTrade cannot confirm revocation, Balance shows a recovery message directing you
            to remove the app in your SnapTrade dashboard. You can also revoke access directly in
            SnapTrade at any time. Clearing the sample workspace removes its locally saved sample
            data.
          </p>
        </section>
        <section>
          <h2>Services that process data</h2>
          <p>
            SnapTrade provides authorization and brokerage data. Vercel hosts the application. The
            configured PostgreSQL provider stores encrypted sessions and workspace data. These
            services process requests needed to operate the app. Infrastructure logs may include
            request metadata such as network addresses; Balance does not intentionally log holdings,
            authorization codes, tokens, or client secrets.
          </p>
        </section>
        <section>
          <h2>Questions and problems</h2>
          <p>
            You can{' '}
            <a
              href="https://github.com/meetgojiya98/SnapTrade/issues"
              target="_blank"
              rel="noreferrer"
            >
              report an issue in the project repository
            </a>
            . Include the request reference shown with an app error when available. Keep account
            numbers, holdings, credentials, and other private information out of public issue
            reports.
          </p>
        </section>
        <Link className={styles.headerCta} href="/">
          Back to Balance
        </Link>
      </main>
    </div>
  );
}
