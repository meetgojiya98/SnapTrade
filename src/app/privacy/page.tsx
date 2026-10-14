import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Fingerprint, ShieldCheck } from 'lucide-react';
import PublicShell from '@/components/public-shell';
import styles from '../resources.module.css';
export const metadata: Metadata = {
  title: 'Privacy & your data — Balance',
  description:
    'How Balance handles portfolio data, sessions, saved plans, and your controls for deletion and disconnect.',
  alternates: { canonical: '/privacy' },
};
export default function PrivacyPage() {
  return (
    <PublicShell currentPage="privacy">
      <div className={styles.hero}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>
            <span>03 /</span> Privacy & your data
          </span>
          <h1>Your portfolio is personal.</h1>
          <p>
            This page explains what Balance stores, why it needs it, and the controls available to
            you. Last updated October 14, 2026.
          </p>
          <div className={styles.actions}>
            <Link className={styles.secondary} href="#controls">
              Explore your controls <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
        <aside className={styles.heroAside} aria-label="Privacy at a glance">
          <div className={styles.asideTop}>
            <span>BY DESIGN</span>
            <Fingerprint size={21} aria-hidden="true" />
          </div>
          <h2>
            Your data.
            <br />
            Your controls.
          </h2>
          <ul className={styles.privacyList}>
            <li>
              <ShieldCheck size={17} aria-hidden="true" />
              <div>
                Read access to shared accounts
                <small>Balance does not request trading permission.</small>
              </div>
            </li>
            <li>
              <ShieldCheck size={17} aria-hidden="true" />
              <div>
                Encrypted financial payloads<small>Stored against your verified identity.</small>
              </div>
            </li>
            <li>
              <ShieldCheck size={17} aria-hidden="true" />
              <div>
                Clear deletion controls<small>Delete plans or saved workspace data.</small>
              </div>
            </li>
          </ul>
          <div className={styles.asideFoot}>
            <span className={styles.statusDot} /> Review the details and limits below.
          </div>
        </aside>
      </div>
      <div className={styles.layout}>
        <nav className={styles.contents} aria-label="On this page">
          <strong>The details</strong>
          <a href="#shared">What you share</a>
          <a href="#stored">What is stored</a>
          <a href="#sessions">Sessions & saved plans</a>
          <a href="#controls">Your controls</a>
          <a href="#services">Service providers</a>
          <a href="#questions">Questions & problems</a>
        </nav>
        <div>
          <section className={styles.section} id="shared">
            <h2>What you share</h2>
            <p>
              When you authorize Balance through SnapTrade, the app receives your verified SnapTrade
              user identifier and permission to read your shared accounts, positions, cash balances,
              and connection status. It does not request trading permission, your email address, or
              your brokerage password.
            </p>
          </section>
          <section className={styles.section} id="stored">
            <h2>What is stored</h2>
            <p>
              The server stores encrypted OAuth credentials so you can stay connected. It also
              stores your allocation targets, constraints, classification confirmations, and any
              plans you choose to save. A saved plan includes the account snapshot used to calculate
              it. Financial payloads are encrypted at rest, associated with your verified SnapTrade
              identity, and accessed through authenticated server routes.
            </p>
            <p>
              The browser receives portfolio data for display and holds an opaque, HttpOnly session
              cookie. OAuth tokens are never placed in browser storage. The explicit sample
              workspace uses fictional data and keeps its preferences and sample plans in this
              browser’s local storage.
            </p>
          </section>
          <section className={styles.section} id="sessions">
            <h2>Sessions, snapshots, and saved plans</h2>
            <p>
              App sessions expire after seven days and login attempts after ten minutes. Cached
              account snapshots are temporary and are not used as proof of fresh prices. Saved plans
              are retained until you delete them or delete your saved workspace data, with a limit
              of 30 plans per workspace.
            </p>
          </section>
          <section className={styles.section} id="controls">
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
            <p>
              Deletion removes the active saved workspace records. The database provider may retain
              encrypted historical copies within its configured restore window. Balance does not
              selectively purge individual records from that recovery history.
            </p>
          </section>
          <section className={styles.section} id="services">
            <h2>Services that process data</h2>
            <p>
              SnapTrade provides authorization and brokerage data. Vercel hosts the application. The
              production database provider, Neon, stores encrypted sessions and workspace data.
              These services process requests needed to operate the app. Infrastructure logs may
              include request metadata such as network addresses; Balance does not intentionally log
              holdings, authorization codes, tokens, or client secrets.
            </p>
          </section>
          <section className={styles.section} id="questions">
            <h2>Questions and problems</h2>
            <p>
              Visit <Link href="/support">Help & support</Link> for recovery guidance and a safe
              issue draft. Include the request reference shown with an app error when available.
              Keep account numbers, holdings, credentials, and other private information out of
              public issue reports.
            </p>
          </section>
          <Link className={styles.secondary} href="/">
            Back to Balance <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </PublicShell>
  );
}
