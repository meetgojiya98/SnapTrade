import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, GitCompareArrows } from 'lucide-react';
import PublicShell from '@/components/public-shell';
import styles from '../resources.module.css';

export const metadata: Metadata = {
  title: 'Getting started — Balance',
  description:
    'Connect your accounts, review your assumptions, and understand every part of a Balance rebalancing plan.',
  alternates: { canonical: '/guide' },
};

export default function GuidePage() {
  return (
    <PublicShell currentPage="guide">
      <div className={styles.hero}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>
            <span>01 /</span> The Balance guide
          </span>
          <h1>From a scattered portfolio to a considered plan.</h1>
          <p>
            A short guide to connecting accounts, choosing your own targets, and reading the details
            behind each proposed move.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/demo">
              Learn with the demo <ArrowRight size={17} />
            </Link>
            <Link className={styles.secondary} href="/app">
              Open workspace <ArrowUpRight size={16} />
            </Link>
          </div>
        </div>
        <aside className={styles.heroAside} aria-label="Four stages of a Balance plan">
          <div className={styles.asideTop}>
            <span>THE PATH TO CLARITY</span>
            <GitCompareArrows size={20} aria-hidden="true" />
          </div>
          <h2>
            Understand
            <br />
            every move.
          </h2>
          <ol className={styles.pathList}>
            <li>
              <span>01</span>
              <div>
                Connect your accounts<small>One view of the bigger picture</small>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                Set your boundaries<small>Your targets. Your assumptions.</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                Explore the plan<small>Read the reasoning behind it</small>
              </div>
            </li>
            <li>
              <span>04</span>
              <div>
                Keep the context<small>Save a snapshot to return to</small>
              </div>
            </li>
          </ol>
          <div className={styles.asideFoot}>
            <span className={styles.statusDot} /> A simulation. Every decision yours.
          </div>
        </aside>
      </div>
      <div className={styles.notice}>
        <strong>Start with the interactive demo.</strong>
        It uses fictional holdings, needs no sign-in, and lets you try the complete planning and
        saved-history flow. Connected accounts are in a limited beta. The current SnapTrade Test app
        supports up to five users; wider access depends on SnapTrade production approval.
      </div>
      <div className={styles.layout}>
        <nav className={styles.contents} aria-label="On this page">
          <strong>On this page</strong>
          <a href="#connect">1. Connect accounts</a>
          <a href="#review">2. Review your setup</a>
          <a href="#plan">3. Read your plan</a>
          <a href="#history">4. Save and return</a>
          <a href="#methodology">The calculation</a>
          <a href="#troubleshooting">When a plan pauses</a>
          <a href="#support">Get private support</a>
        </nav>
        <div>
          <section className={styles.section} id="connect">
            <h2>1. Bring your accounts together.</h2>
            <p>
              Balance connects to accounts you manage in{' '}
              <a href="https://dashboard.snaptrade.com" target="_blank" rel="noreferrer">
                SnapTrade Personal
              </a>
              . You do not need to generate an API key or set up a Commercial workspace to use
              Balance.
            </p>
            <ol>
              <li>
                Sign in to SnapTrade and choose or create a Personal workspace. Add your brokerage
                there, or use SnapTrade Sandbox for simulated accounts.
              </li>
              <li>
                Return to <Link href="/app">your Balance workspace</Link> and choose Connect with
                SnapTrade.
              </li>
              <li>
                Review the consent screen at SnapTrade. Balance requests sign-in and read access to
                accounts. It does not request permission to trade.
              </li>
              <li>
                After returning to Balance, review the accounts and their source timestamps.
                Additions and brokerage repairs happen in SnapTrade Personal; return and reload
                available snapshots afterwards.
              </li>
            </ol>
            <div className={styles.notice}>
              <strong>Why does consent say “CIBC”?</strong>
              The current beta app is registered under a SnapTrade Commercial workspace named CIBC,
              so SnapTrade shows that name during consent. It is the registration name for this
              integration, not a claim of affiliation with the bank. Only approve access if that
              matches the beta connection you intended to make.
            </div>
            <p style={{ marginTop: 16 }}>
              See{' '}
              <a href="https://docs.snaptrade.com/docs/oauth-apps" target="_blank" rel="noreferrer">
                SnapTrade’s OAuth guide
              </a>{' '}
              for its account and consent model, or{' '}
              <a href="https://docs.snaptrade.com/docs/sandbox" target="_blank" rel="noreferrer">
                the Sandbox guide
              </a>{' '}
              for simulated brokerage connections.
            </p>
          </section>
          <section className={styles.section} id="review">
            <h2>2. Make the assumptions yours.</h2>
            <p>
              Your first workspace visit includes a setup checklist. Review each item and choose
              Save workspace preferences. The sample’s starting values illustrate the controls; they
              are not a recommended allocation.
            </p>
            <dl className={styles.definition}>
              <dt>Target mix</dt>
              <dd>
                Set your own percentages for US equities, international equities, and bonds. They
                must total 100%. The planner does not decide which mix is suitable for you.
              </dd>
            </dl>
            <dl className={styles.definition}>
              <dt>Cash reserve</dt>
              <dd>
                Choose the cash to protect in each selected account. The reserve is excluded from
                the planning base. If starting cash is below it, the model can consider permitted
                whole-share sales to restore it; the plan pauses if the reserve cannot be funded.
              </dd>
            </dl>
            <dl className={styles.definition}>
              <dt>Minimum trade</dt>
              <dd>
                Set a minimum proposed trade value to reduce small moves. Together with whole
                shares, this can leave allocation drift after the plan.
              </dd>
            </dl>
            <dl className={styles.definition}>
              <dt>Taxable sales</dt>
              <dd>
                Sales in taxable accounts start disabled. Enabling them permits the simulation to
                consider those sales; it does not calculate capital gains, losses, or tax owed.
              </dd>
            </dl>
            <dl className={styles.definition}>
              <dt>Classifications</dt>
              <dd>
                Review unknown asset classes and account tax treatment against your own records.
                Confirmations are saved with your preferences. They cannot make unsupported
                instruments or missing prices eligible.
              </dd>
            </dl>
            <p style={{ marginTop: 20 }}>
              Select the accounts you want to include. When modeling a future contribution, choose
              its destination account. Hypothetical contributions belong to that scenario and are
              never transferred or saved as a standing cash balance.
            </p>
          </section>
          <section className={styles.section} id="plan">
            <h2>3. Understand the proposed moves.</h2>
            <p>
              Open Rebalance to see the result for your selected accounts and current assumptions.
              Every move is a simulation using indicative source prices. There are no executable
              orders.
            </p>
            <h3>Read the allocation comparison.</h3>
            <p>
              Current and projected percentages show how the modeled trades move the portfolio
              towards your targets. Drift is half the sum of the absolute percentage-point gaps
              across the asset classes and cash, with a zero target for investable cash. A lower
              number means a closer modeled match, not a forecast of returns.
            </p>
            <h3>Follow the funding account by account.</h3>
            <p>
              Each account starts with its own reported cash, adds any hypothetical contribution
              assigned to it and proceeds from its proposed sales, then subtracts proposed buys. Its
              ending cash must preserve the chosen reserve. Cash at another brokerage cannot fund
              those purchases.
            </p>
            <h3>Check the remaining gap.</h3>
            <p>
              Whole shares, minimum trade sizes, available holdings, and your sale permissions can
              prevent an exact target match. Balance buys only eligible securities already held in
              the same account. A cash-only account can produce a valid zero-trade snapshot because
              it has no existing security to buy.
            </p>
          </section>
          <section className={styles.section} id="history">
            <h2>4. Keep the reasoning with the plan.</h2>
            <p>
              Give a ready plan a name and save it. In a connected workspace, the server fetches
              brokerage data again and recalculates before saving. If the source changed or became
              incomplete, the saved result can differ from the preview or require another review.
            </p>
            <p>
              Saved plans preserve the original holdings, indicative prices, source timestamps,
              selected accounts, targets, constraints, hypothetical contribution, and result.
              Changing today’s setup does not rewrite yesterday’s snapshot. Open Saved plans to
              inspect it or download its historical CSV.
            </p>
            <p>
              Your connected preferences and up to 30 plans follow your verified SnapTrade identity.
              The demo keeps up to 25 sample plans only in this browser. In Connections, you can
              delete saved workspace data or disconnect SnapTrade; these are separate controls.{' '}
              <Link href="/privacy">Read how your data is handled.</Link>
            </p>
          </section>
          <section className={styles.section} id="methodology">
            <h2>What the calculation includes.</h2>
            <p>
              Balance models whole-share trades for supported USD stocks and ETFs. It uses integer
              cents for its cash checks and a bounded, deterministic search for moves that improve
              the target mix. It does not guarantee the mathematically best allocation.
            </p>
            <p>
              Prices and balances are snapshots from the source. Reloading does not imply a new
              market price or trigger an instant brokerage sync. The planner pauses on missing or
              inconsistent data, source snapshots older than 24 hours, or timestamps more than five
              minutes in the future.
            </p>
            <p>
              The model excludes fees, spreads, realized taxes, settlement delays, margin, currency
              conversion, and actual execution prices. Balance is a planning tool; verify any
              decision against your brokerage records and your circumstances before acting
              independently.
            </p>
            <p>
              The{' '}
              <a
                href="https://github.com/meetgojiya98/SnapTrade/blob/main/docs/architecture.md"
                target="_blank"
                rel="noreferrer"
              >
                published calculation contract
              </a>{' '}
              explains the implementation and its limits.
            </p>
          </section>
          <section className={styles.section} id="troubleshooting">
            <h2>A paused plan has a reason.</h2>
            <p>
              Balance shows the affected account and the checks that need attention. It keeps
              unsupported or incomplete positions visible rather than silently leaving them out of
              the calculation.
            </p>
            <ul>
              <li>
                <strong>Unknown classification or tax treatment:</strong> inspect the holding or
                account in Portfolio, verify it, and save your preferences.
              </li>
              <li>
                <strong>Stale data, missing prices, or a disabled connection:</strong> inspect or
                repair the brokerage connection in SnapTrade Personal, then reload available
                snapshots in Balance.
              </li>
              <li>
                <strong>Options, crypto, mutual funds, shorts, or mixed currencies:</strong> select
                a supported account to explore a plan. Reclassifying an asset does not remove its
                instrument or currency restrictions.
              </li>
              <li>
                <strong>Expired sign-in:</strong> reconnect with the same SnapTrade Personal
                identity to return to your saved preferences and plans.
              </li>
            </ul>
            <Link className={styles.secondary} href="/support">
              Find more help <ArrowRight size={16} />
            </Link>
          </section>
          <section className={styles.section} id="support">
            <h2>A conversation that stays private.</h2>
            <p>
              If the recovery steps do not resolve the problem, open{' '}
              <Link href="/support/inbox">your private support inbox</Link> using the same SnapTrade
              sign-in as your workspace. Choose a category, describe what happened, and include the
              error’s request reference when available. No portfolio data is attached automatically.
            </p>
            <p>
              Return to the inbox to read replies and continue the conversation. There are no email
              notifications or guaranteed response times during the beta. You can resolve a request,
              reopen it if the problem returns, or delete it. Support conversations have separate
              deletion controls from saved plans and workspace preferences.{' '}
              <Link href="/privacy#support">Read the support data policy.</Link>
            </p>
          </section>
        </div>
      </div>
    </PublicShell>
  );
}
