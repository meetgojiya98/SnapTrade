import Link from 'next/link';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  GitCompareArrows,
  Landmark,
  LockKeyhole,
  ShieldCheck,
} from 'lucide-react';
import { makeDemoPortfolio } from '@/lib/demo';
import { accountValueCents, defaultTargets, generatePlan } from '@/lib/planner';
import styles from './landing.module.css';

const format = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
export default function Home() {
  const sample = makeDemoPortfolio();
  const result = generatePlan(sample.accounts, {
    targets: defaultTargets,
    allowTaxableSales: false,
    cashBufferCents: 25000,
    contributionCents: 0,
    contributionAccountId: null,
    minimumTradeCents: 10000,
    now: sample.asOf,
  });
  const total = sample.accounts.reduce((sum, a) => sum + accountValueCents(a), 0);
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link className={styles.logo} href="/" aria-label="Balance home">
          <span aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          balance.
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#your-control">Your control</a>
          <Link href="/privacy">Privacy</Link>
        </nav>
        <Link className={styles.headerCta} href="/app">
          Open workspace <ArrowUpRight size={15} />
        </Link>
      </header>
      <main className={styles.main} id="content">
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.eyebrow}>A LITTLE CLARITY FOR YOUR NEXT MOVE</span>
            <h1>
              Your accounts.
              <br />
              One considered
              <br />
              <em>plan.</em>
            </h1>
            <p>
              Bring your investments into one view. Set your own targets. Review a rebalance that
              respects the cash in every account.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primary} href="/app">
                Connect your portfolio <ArrowRight size={17} />
              </Link>
              <Link className={styles.secondary} href="/demo">
                Explore sample portfolio <ArrowUpRight size={16} />
              </Link>
            </div>
            <div className={styles.heroTrust}>
              <ShieldCheck size={16} />
              <span>Read-only access. Every decision stays yours.</span>
            </div>
          </div>
          <div className={styles.preview} aria-label="Illustrative rebalancing plan">
            <div className={styles.previewTop}>
              <span>
                <i />
                SAMPLE PORTFOLIO
              </span>
              <span>USD</span>
            </div>
            <div className={styles.previewTotal}>
              <span>Your whole picture</span>
              <strong>{format(total)}</strong>
              <small>3 illustrative brokerage accounts</small>
            </div>
            <div className={styles.mix}>
              <span style={{ width: '50%' }} />
              <span style={{ width: '30%' }} />
              <span style={{ width: '20%' }} />
            </div>
            <div className={styles.mixLabels}>
              <span>50% US equities</span>
              <span>30% International</span>
              <span>20% Bonds</span>
            </div>
            <div className={styles.planPreview}>
              <div className={styles.planPreviewTitle}>
                <span>
                  <GitCompareArrows size={17} />A more balanced mix
                </span>
                <span>{result.trades.length} moves</span>
              </div>
              <div className={styles.drift}>
                <div>
                  <span>Current drift</span>
                  <strong>
                    {result.driftBefore.toFixed(1)}
                    <small> pp</small>
                  </strong>
                </div>
                <ArrowRight size={22} />
                <div>
                  <span>After the plan</span>
                  <strong>
                    {result.driftAfter.toFixed(1)}
                    <small> pp</small>
                  </strong>
                </div>
              </div>
              <div className={styles.checks}>
                <span>
                  <Check size={13} />
                  Whole shares
                </span>
                <span>
                  <Check size={13} />
                  No taxable sales
                </span>
                <span>
                  <Check size={13} />
                  Cash protected
                </span>
              </div>
            </div>
            <div className={styles.accountPreview}>
              {sample.accounts.map((account) => (
                <div key={account.id}>
                  <span>
                    <Landmark size={15} />
                    {account.broker}
                  </span>
                  <strong>{format(accountValueCents(account))}</strong>
                </div>
              ))}
            </div>
            <p className={styles.exampleNote}>
              Illustrative holdings and prices. This is a simulation, not a market feed.
            </p>
          </div>
        </section>
        <div className={styles.promiseBar}>
          <span>
            Built with <strong>SnapTrade OAuth</strong>
          </span>
          <span>
            <LockKeyhole size={14} />
            Your brokerage password stays private
          </span>
          <span>
            <ShieldCheck size={15} />
            No permission to place trades
          </span>
        </div>
        <section className={styles.workflow} id="how-it-works">
          <div className={styles.sectionIntro}>
            <span className={styles.eyebrow}>FROM CONNECTED TO CONSIDERED</span>
            <h2>
              A useful plan starts
              <br />
              with the whole picture.
            </h2>
            <p>
              Made for investors with USD stocks and ETFs across multiple accounts, who want to
              understand their next move before making it.
            </p>
          </div>
          <div className={styles.steps}>
            <article>
              <span className={styles.stepNumber}>01</span>
              <Landmark size={23} />
              <h3>Bring your accounts together.</h3>
              <p>
                Sign in with SnapTrade Personal and share your connected accounts. Your holdings and
                cash stay tied to the brokerage they belong to.
              </p>
            </article>
            <article>
              <span className={styles.stepNumber}>02</span>
              <GitCompareArrows size={23} />
              <h3>Make the assumptions yours.</h3>
              <p>
                Choose a target mix, protect a cash reserve, and review unfamiliar assets. Balance
                keeps your choices for your next visit.
              </p>
            </article>
            <article>
              <span className={styles.stepNumber}>03</span>
              <ShieldCheck size={23} />
              <h3>Review every proposed move.</h3>
              <p>
                See whole-share trades, each account’s funding, and the remaining drift. Save a
                dated plan and export it for your own review.
              </p>
            </article>
          </div>
        </section>
        <section className={styles.control} id="your-control">
          <div>
            <span className={styles.eyebrow}>YOUR MONEY. YOUR BOUNDARIES.</span>
            <h2>
              The details are
              <br />
              the difference.
            </h2>
            <p>A portfolio-wide percentage should never hide an account-level constraint.</p>
            <Link href="/demo">
              See the planner in action <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className={styles.controlList}>
            <article>
              <Check size={18} />
              <div>
                <h3>Cash stays in its own account.</h3>
                <p>
                  A surplus at one brokerage cannot silently fund a purchase at another. The funding
                  ledger makes every proposed move traceable.
                </p>
              </div>
            </article>
            <article>
              <Check size={18} />
              <div>
                <h3>Taxable sales are your choice.</h3>
                <p>
                  They start disabled. You can opt in, with a clear reminder that Balance does not
                  calculate your tax liability.
                </p>
              </div>
            </article>
            <article>
              <Check size={18} />
              <div>
                <h3>Incomplete data pauses the plan.</h3>
                <p>
                  Missing prices, stale snapshots, unsupported instruments, and mixed currencies are
                  surfaced before recommendations are made.
                </p>
              </div>
            </article>
            <article>
              <Check size={18} />
              <div>
                <h3>Saved plans keep their context.</h3>
                <p>
                  A saved plan is a dated record of a simulation, with its targets and assumptions.
                  It is never presented as an executable order.
                </p>
              </div>
            </article>
          </div>
        </section>
        <section className={styles.faq}>
          <div className={styles.sectionIntro}>
            <span className={styles.eyebrow}>A FEW GOOD QUESTIONS</span>
            <h2>
              Know what you’re
              <br />
              connecting to.
            </h2>
          </div>
          <div>
            <details>
              <summary>Do I need a SnapTrade account?</summary>
              <p>
                Yes. You sign in with SnapTrade Personal and grant Balance read access to accounts
                you manage there. You can add or reconnect brokerages in your SnapTrade dashboard,
                then return to Balance and reload your snapshot.
              </p>
            </details>
            <details>
              <summary>Will Balance place trades or move my money?</summary>
              <p>
                No. Balance requests read access and creates a simulation. It never submits an order
                or transfers cash. You decide whether to act in your own brokerage.
              </p>
            </details>
            <details>
              <summary>What portfolios can I plan with?</summary>
              <p>
                The current planner supports USD stocks and ETFs in accounts with complete, recent
                data. You can classify unfamiliar holdings. It buys only eligible securities already
                held in each account and may leave cash or drift when your constraints prevent a
                closer match.
              </p>
            </details>
            <details>
              <summary>What should I know about the estimates?</summary>
              <p>
                Prices come from brokerage snapshots and may be delayed. The planner uses a bounded
                heuristic. Fees, taxes, spreads, settlement, and FX are not modeled, and the
                mathematically best allocation is not guaranteed.
              </p>
            </details>
            <details>
              <summary>How do I control my data?</summary>
              <p>
                OAuth tokens and saved financial payloads are encrypted on the server. You can
                remove saved plans, delete your saved workspace data, and disconnect SnapTrade
                inside the app. <Link href="/privacy">Read how your data is handled.</Link>
              </p>
            </details>
          </div>
        </section>
        <section className={styles.finalCta}>
          <span className={styles.eyebrow}>A CLEARER HEAD FOR YOUR WHOLE PORTFOLIO</span>
          <h2>
            Make your next move
            <br />
            with perspective.
          </h2>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/app">
              Connect your portfolio <ArrowRight size={17} />
            </Link>
            <Link className={styles.secondary} href="/demo">
              Explore sample portfolio <ArrowUpRight size={16} />
            </Link>
          </div>
          <p>Try the sample workspace before sharing any account data.</p>
        </section>
      </main>
      <footer className={styles.footer}>
        <Link className={styles.logo} href="/">
          balance.
        </Link>
        <span>A thoughtful plan. A little more clarity.</span>
        <div>
          <Link href="/privacy">Privacy & data</Link>
          <a
            href="https://github.com/meetgojiya98/SnapTrade/issues"
            target="_blank"
            rel="noreferrer"
          >
            Report an issue <ArrowUpRight size={13} />
          </a>
          <a href="https://github.com/meetgojiya98/SnapTrade" target="_blank" rel="noreferrer">
            Source <ArrowUpRight size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
