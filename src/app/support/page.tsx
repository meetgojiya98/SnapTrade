import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Cable,
  FileClock,
  LifeBuoy,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import PublicShell from '@/components/public-shell';
import SupportReport from '@/components/support-report';
import styles from '../resources.module.css';

export const metadata: Metadata = {
  title: 'Help & support — Balance',
  description:
    'Resolve common Balance questions, open private in-app support, or prepare a non-sensitive public product issue.',
  alternates: { canonical: '/support' },
};

export default function SupportPage() {
  return (
    <PublicShell currentPage="support">
      <div className={styles.hero}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>
            <span>02 /</span> Help & support
          </span>
          <h1>A clear next step, when you need one.</h1>
          <p>
            Start with the guidance below. For a personal product question, open a private support
            conversation. Use the public issue draft for non-sensitive bugs and feedback.
          </p>
          <div className={styles.actions}>
            <Link href="/support/inbox" className={styles.primary}>
              Open private support <ArrowRight size={16} />
            </Link>
            <Link href="/guide" className={styles.secondary}>
              Read the getting-started guide <ArrowRight size={16} />
            </Link>
          </div>
        </div>
        <aside className={styles.heroAside} aria-label="A clear path to help">
          <div className={styles.asideTop}>
            <span>LET’S GET YOU UNSTUCK</span>
            <LifeBuoy size={20} aria-hidden="true" />
          </div>
          <h2>
            A little context.
            <br />A better next step.
          </h2>
          <p>
            Find the relevant guidance below, or include an error’s request reference in a private
            conversation. Sign in with your Balance identity to view replies.
          </p>
          <div className={styles.referencePreview} aria-hidden="true">
            <span>REQUEST REFERENCE</span>
            <div>
              xxxxxxxx-xxxx-xxxx<span>↗</span>
            </div>
          </div>
          <a className={styles.asideLink} href="#report-title">
            Prepare a report <ArrowUpRight size={17} aria-hidden="true" />
          </a>
          <div className={styles.asideFoot}>
            <ShieldCheck size={14} aria-hidden="true" /> Keep your financial information private.
          </div>
        </aside>
      </div>
      <div className={styles.grid}>
        <section className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon}>
              <Cable size={22} aria-hidden="true" />
            </span>
            <span>01 / CONNECTIONS</span>
          </div>
          <h2>I can’t connect my accounts.</h2>
          <p>
            Use a SnapTrade Personal workspace with a brokerage connection. Return to Balance to
            sign in and authorize read access. If you cancelled consent or your sign-in expired, try
            connecting again.
          </p>
          <p>
            Connected access is a limited beta using a five-user SnapTrade Test app. If that limit
            is reached, use the interactive demo until wider access is available. The current
            consent registration is named CIBC; the guide explains why.
          </p>
          <Link href="/guide#connect">
            Connection walkthrough <ArrowRight size={15} />
          </Link>
        </section>
        <section className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon}>
              <ScanLine size={22} aria-hidden="true" />
            </span>
            <span>02 / PORTFOLIO & PLANS</span>
          </div>
          <h2>My portfolio or plan needs attention.</h2>
          <p>
            Check the affected account’s source timestamp and the reasons shown in the workspace.
            Unknown classifications need review; unsupported instruments, currencies, and missing
            prices cannot be cleared with a label change.
          </p>
          <p>
            Repair disabled brokerage connections in SnapTrade Personal, then reload available
            snapshots. A reload may return the same source data. If SnapTrade asks you to wait,
            pause before trying again.
          </p>
          <Link href="/guide#troubleshooting">
            Understand the data checks <ArrowRight size={15} />
          </Link>
        </section>
        <section className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon}>
              <FileClock size={22} aria-hidden="true" />
            </span>
            <span>03 / SAVED HISTORY</span>
          </div>
          <h2>Where are my saved preferences or plans?</h2>
          <p>
            Connected plans belong to the SnapTrade Personal identity that saved them. Reconnect
            with that identity. If history cannot load, use its retry control; current portfolio
            data can still be available.
          </p>
          <p>
            Demo plans belong to this browser and this site’s origin. Clearing site storage or using
            another browser does not carry them over. Historical plans and CSVs retain their
            original policy, even after current settings change.
          </p>
          <Link href="/guide#history">
            How saved history works <ArrowRight size={15} />
          </Link>
        </section>
        <section className={styles.card}>
          <div className={styles.cardTop}>
            <span className={styles.cardIcon}>
              <ShieldCheck size={22} aria-hidden="true" />
            </span>
            <span>04 / YOUR DATA</span>
          </div>
          <h2>I want to remove my data or access.</h2>
          <p>
            In Connections, Delete workspace data removes saved preferences and plan history.
            Disconnect removes the local credentials and attempts to revoke SnapTrade access.
            Disconnecting alone preserves your saved plans.
          </p>
          <p>
            If revocation could not be confirmed, remove the app directly in SnapTrade. Never post a
            portfolio screenshot, account number, API key, token, or password in a public issue.
          </p>
          <Link href="/privacy">
            Your privacy controls <ArrowRight size={15} />
          </Link>
        </section>
      </div>
      <SupportReport />
      <div className={styles.notice}>
        <strong>Brokerage connection problem?</strong>
        Balance can only read the data made available to it. Manage brokerages in{' '}
        <a href="https://dashboard.snaptrade.com" target="_blank" rel="noreferrer">
          SnapTrade Personal <ArrowUpRight size={12} />
        </a>
        . The{' '}
        <a
          href="https://docs.snaptrade.com/docs/fix-broken-connections"
          target="_blank"
          rel="noreferrer"
        >
          SnapTrade connection recovery guide
        </a>{' '}
        explains disabled connections. The issue tracker is for Balance product problems and
        feedback; it is not a private support channel.
      </div>
    </PublicShell>
  );
}
