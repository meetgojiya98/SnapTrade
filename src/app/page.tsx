import Link from 'next/link';
import type { Metadata } from 'next';
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  CircleArrowDown,
  Bookmark,
  Check,
  ChevronDown,
  FileCheck2,
  Fingerprint,
  GitCompareArrows,
  Landmark,
  LockKeyhole,
  MoveUpRight,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { makeDemoPortfolio } from '@/lib/demo';
import { accountValueCents, defaultTargets, generatePlan } from '@/lib/planner';
import LandingHeader from '@/components/landing/header';
import PortfolioPreview from '@/components/landing/portfolio-preview';
import styles from './landing.module.css';

export const metadata: Metadata = { alternates: { canonical: '/' } };

const dollars = (cents: number, digits = 0) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(cents / 100);

const questions = [
  {
    title: 'Can I connect my own accounts?',
    text: (
      <>
        Connected access is currently a limited beta using SnapTrade’s five-user test access. A
        broader rollout is pending SnapTrade approval. The interactive demo is available now and
        needs no sign-in. If you already have beta access,{' '}
        <Link href="/app">open your workspace</Link>.
      </>
    ),
  },
  {
    title: 'Will Balance trade or move my money?',
    text: (
      <>
        No. Balance reads shared account data and builds a simulation. It never places an order or
        transfers cash. You decide whether to act, and you place any trades at your own brokerage.
      </>
    ),
  },
  {
    title: 'Which portfolios does the planner support?',
    text: (
      <>
        The current planner is built for USD stocks and ETFs across taxable and retirement accounts.
        You choose targets for US equities, international equities, and bonds. It buys eligible
        securities already held in each account. Mixed currencies, unsupported holdings, and
        incomplete data need review before planning.
      </>
    ),
  },
  {
    title: 'How does Balance choose the proposed moves?',
    text: (
      <>
        It looks for whole-share moves that bring your allocation closer to your targets while
        respecting cash and sales constraints in each account. The method is deterministic and
        bounded; it does not guarantee a perfect or mathematically optimal allocation.{' '}
        <Link href="/guide">Read the planning guide</Link>.
      </>
    ),
  },
  {
    title: 'Are prices, taxes, and fees included?',
    text: (
      <>
        Prices are brokerage snapshots and may be delayed. Fees, taxes, spreads, settlement time,
        and foreign exchange are not modeled. Taxable sales start disabled, and stale or unavailable
        prices pause the plan. Always review current conditions before making a decision.
      </>
    ),
  },
  {
    title: 'What happens to my data?',
    text: (
      <>
        Connection credentials and saved financial data are encrypted on the server. You can delete
        a saved plan, clear your saved workspace data, or disconnect from SnapTrade. The demo keeps
        only sample preferences and plans in your browser.{' '}
        <Link href="/privacy">See our privacy details</Link>.
      </>
    ),
  },
];

export default function Home() {
  const sample = makeDemoPortfolio();
  const reserveCents = 25_000;
  const result = generatePlan(sample.accounts, {
    targets: defaultTargets,
    allowTaxableSales: false,
    cashBufferCents: reserveCents,
    contributionCents: 0,
    contributionAccountId: null,
    minimumTradeCents: 10_000,
    now: sample.asOf,
  });
  const total = sample.accounts.reduce((sum, account) => sum + accountValueCents(account), 0);
  const ledgers = sample.accounts.map((account) => {
    const sells = result.trades
      .filter((trade) => trade.accountId === account.id && trade.side === 'sell')
      .reduce((sum, trade) => sum + trade.valueCents, 0);
    const buys = result.trades
      .filter((trade) => trade.accountId === account.id && trade.side === 'buy')
      .reduce((sum, trade) => sum + trade.valueCents, 0);
    return { ...account, sells, buys, after: account.cashCents + sells - buys };
  });
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <LandingHeader />
      <main className={styles.main} id="content" tabIndex={-1}>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <span className={styles.heroEyebrow}>
              <span /> LESS NOISE. MORE PERSPECTIVE.
            </span>
            <h1>
              Your portfolio.
              <br />
              A clearer
              <br />
              <em>perspective.</em>
            </h1>
            <p>
              Different accounts. One bigger picture. Bring your investments together and build a
              rebalance plan that works within your boundaries.
            </p>
            <div className={styles.actions}>
              <Link className={styles.primary} href="/demo">
                Try the interactive demo
                <ArrowRight size={18} />
              </Link>
              <a className={styles.secondary} href="#how-it-works">
                See how it works
                <CircleArrowDown size={18} />
              </a>
            </div>
            <div className={styles.heroTrust}>
              <ShieldCheck size={16} />
              <span>No sign-in for the demo. No trades, ever.</span>
            </div>
            <span className={styles.betaNote}>
              Built for USD stocks & ETFs. Connected access is in limited beta.
            </span>
          </div>
          <PortfolioPreview
            plan={result}
            totalCents={total}
            reserveCents={reserveCents}
            accountCount={sample.accounts.length}
          />
        </section>
        <div className={styles.contextStrip}>
          <p>
            YOUR PORTFOLIO, CONNECTED
            <br />
            <strong>One view. Every detail.</strong>
          </p>
          <span>
            <Landmark size={19} />
            Multiple brokerage accounts
          </span>
          <span>
            <GitCompareArrows size={19} />
            Account-aware planning
          </span>
          <span>
            <LockKeyhole size={19} />
            Read-only via SnapTrade
          </span>
        </div>

        <section className={styles.productStory} id="product">
          <div className={styles.storyIntro}>
            <span className={styles.eyebrow}>01 / THE BIGGER PICTURE</span>
            <h2>
              Less scattered.
              <br />
              <em>More considered.</em>
            </h2>
          </div>
          <div className={styles.storyCopy}>
            <p>
              You know the mix you want. But your money lives in different places, with different
              boundaries.
            </p>
            <p>
              Cash at one brokerage can’t fund a purchase at another. Whole shares leave gaps. A
              taxable account needs its own rules. Balance keeps those details in the picture.
            </p>
            <a href="#funding" className={styles.inlineLink}>
              Follow the cash <ArrowDown size={16} />
            </a>
          </div>
        </section>

        <section className={styles.fundingSection} id="funding" aria-labelledby="funding-heading">
          <div className={styles.fundingIntro}>
            <div>
              <span className={styles.eyebrow}>CLARITY, DOWN TO THE LAST DOLLAR</span>
              <h2 id="funding-heading">
                Every move.
                <br />
                <em>Accounted for.</em>
              </h2>
            </div>
            <p>
              A useful rebalance needs more than a better-looking pie chart. See where each proposed
              buy is funded, and what stays in every account.
            </p>
          </div>
          <div className={styles.fundingLedger}>
            <div className={styles.ledgerHeading}>
              <div>
                <span className={styles.ledgerIcon}>
                  <Landmark size={20} />
                </span>
                <div>
                  <h3>Three accounts. Three cash boundaries.</h3>
                  <p>From the same fictional portfolio you can explore in the demo.</p>
                </div>
              </div>
              <span className={styles.ledgerSample}>ILLUSTRATIVE PLAN · USD</span>
            </div>
            <p className={styles.ledgerScrollHint}>
              Scroll to follow each account’s funding <ArrowRight size={13} />
            </p>
            <div
              className={styles.ledgerTableWrap}
              tabIndex={0}
              role="region"
              aria-label="Sample account funding, scroll horizontally to see all columns"
            >
              <table className={styles.ledgerTable}>
                <thead>
                  <tr>
                    <th scope="col">ACCOUNT</th>
                    <th scope="col">REPORTED CASH</th>
                    <th scope="col">+ EST. SELLS</th>
                    <th scope="col">− EST. BUYS</th>
                    <th scope="col">CASH AFTER</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgers.map((account, index) => (
                    <tr key={account.id}>
                      <td>
                        <span className={styles.brokerNumber}>
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span>
                          <strong>{account.broker}</strong>
                          <small>
                            {account.name} · {account.number}
                          </small>
                        </span>
                      </td>
                      <td>{dollars(account.cashCents)}</td>
                      <td>{dollars(account.sells)}</td>
                      <td>{dollars(account.buys)}</td>
                      <td>
                        <strong>{dollars(account.after)}</strong>
                        <span className={styles.reserveCheck}>
                          <Check size={12} />
                          Reserve kept
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.ledgerBottom}>
              <span>
                <ShieldCheck size={16} />
                {dollars(reserveCents)} protected in each account
              </span>
              <span>Cash stays local. No transfers. No borrowing.</span>
            </div>
          </div>
          <div className={styles.fundingCaption}>
            <span>Whole-share estimates. Sale proceeds may need to settle before buying.</span>
            <Link href="/demo?view=rebalance">
              Explore the complete sample plan <ArrowUpRight size={17} />
            </Link>
          </div>
        </section>

        <section className={styles.workflow} id="how-it-works">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.eyebrow}>02 / FIND YOUR NEXT MOVE</span>
              <h2>
                From scattered accounts
                <br />
                <em>to a clear plan.</em>
              </h2>
            </div>
            <Link className={styles.inlineLink} href="/guide">
              Read the getting-started guide <ArrowUpRight size={17} />
            </Link>
          </div>
          <div className={styles.steps}>
            <article>
              <div className={styles.stepTop}>
                <span>01</span>
                <Landmark size={25} />
              </div>
              <h3>See everything together.</h3>
              <p>
                Start with the demo, or use SnapTrade to share your connected accounts. Understand
                your holdings, cash, and allocation in one view.
              </p>
              <div className={styles.stepIllustration}>
                <span>
                  <i />
                  Your brokerage
                </span>
                <span>
                  <i />
                  Your retirement account
                </span>
                <span>
                  <i />
                  Your whole picture
                  <Check size={14} />
                </span>
              </div>
            </article>
            <article>
              <div className={styles.stepTop}>
                <span>02</span>
                <SlidersHorizontal size={25} />
              </div>
              <h3>Make the boundaries yours.</h3>
              <p>
                Choose your target mix, cash reserve, and minimum trade. Confirm unfamiliar
                holdings, and decide whether taxable sales are in scope.
              </p>
              <div className={styles.miniTargets}>
                <span style={{ flex: 50 }}>50%</span>
                <span style={{ flex: 30 }}>30%</span>
                <span style={{ flex: 20 }}>20%</span>
                <small>US EQUITIES / INTERNATIONAL / BONDS</small>
              </div>
            </article>
            <article>
              <div className={styles.stepTop}>
                <span>03</span>
                <FileCheck2 size={25} />
              </div>
              <h3>Understand the next move.</h3>
              <p>
                Review every proposed trade and its funding. Save a dated snapshot with your
                original policy and export it for your own review.
              </p>
              <div className={styles.miniSaved}>
                <span>
                  <Bookmark size={19} />
                </span>
                <div>
                  <strong>Your considered plan</strong>
                  <small>Original data. Decisions in context.</small>
                </div>
                <Check size={17} />
              </div>
            </article>
          </div>
        </section>

        <section className={styles.controls} id="your-control">
          <div className={styles.controlVisual} aria-label="Illustrative planning preferences">
            <div className={styles.controlVisualTop}>
              <SlidersHorizontal size={20} />
              <span>Your planning preferences</span>
              <span>Sample</span>
            </div>
            <h3>
              Good boundaries
              <br />
              make better plans.
            </h3>
            <div className={styles.controlSetting}>
              <span>
                Cash reserve per account<small>Protected from proposed buys</small>
              </span>
              <strong>{dollars(reserveCents)}</strong>
            </div>
            <div className={styles.controlSetting}>
              <span>
                Minimum trade<small>Keep small moves out of the plan</small>
              </span>
              <strong>$100</strong>
            </div>
            <div className={styles.controlSetting}>
              <span>
                Allow taxable sales<small>You choose when to include them</small>
              </span>
              <span className={styles.staticToggle} role="img" aria-label="Taxable sales disabled">
                <i />
              </span>
            </div>
            <div className={styles.controlVisualFoot}>
              <ShieldCheck size={15} />
              Whole shares. No margin. No account transfers.
            </div>
          </div>
          <div className={styles.controlsCopy}>
            <span className={styles.eyebrow}>03 / ALWAYS IN YOUR HANDS</span>
            <h2>
              Your money.
              <br />
              <em>Your ground rules.</em>
            </h2>
            <p>
              Set the direction. We’ll make the details visible. From the cash you keep aside to the
              trades you’re comfortable considering.
            </p>
            <div className={styles.controlList}>
              <article>
                <ShieldCheck size={21} />
                <div>
                  <h3>See the assumptions.</h3>
                  <p>
                    Targets, reserves, tax treatment, and classifications belong to you. Incomplete
                    or stale data pauses the plan.
                  </p>
                </div>
              </article>
              <article>
                <Fingerprint size={21} />
                <div>
                  <h3>Keep control of your data.</h3>
                  <p>
                    Read-only access, encrypted credentials and financial data, and clear controls
                    to delete saved plans or disconnect.
                  </p>
                </div>
              </article>
              <article>
                <Bookmark size={21} />
                <div>
                  <h3>Keep the context, too.</h3>
                  <p>
                    Saved plans preserve the original snapshot and policy. Historical records stay
                    clearly separate from a current simulation.
                  </p>
                </div>
              </article>
            </div>
            <Link className={styles.inlineLink} href="/privacy">
              How we handle your data <ArrowUpRight size={16} />
            </Link>
          </div>
        </section>

        <section className={styles.faq} id="questions">
          <div>
            <span className={styles.eyebrow}>04 / THE DETAILS MATTER</span>
            <h2>
              Good questions.
              <br />
              <em>Clear answers.</em>
            </h2>
            <p>Something else on your mind?</p>
            <Link className={styles.inlineLink} href="/support">
              Visit support <ArrowUpRight size={16} />
            </Link>
          </div>
          <div className={styles.faqList}>
            {questions.map((question) => (
              <details key={question.title}>
                <summary>
                  {question.title}
                  <ChevronDown size={19} />
                </summary>
                <div>{question.text}</div>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.finalCta}>
          <span className={styles.eyebrow}>A CLEARER PICTURE STARTS HERE</span>
          <h2>
            Your next move.
            <br />
            <em>In perspective.</em>
          </h2>
          <p>
            Explore the sample. Adjust your targets. See the possibilities.
            <br className={styles.desktopBreak} /> Your next move is always yours.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/demo">
              Try the interactive demo <ArrowRight size={18} />
            </Link>
            <Link className={styles.secondary} href="/app">
              Open beta workspace <ArrowUpRight size={17} />
            </Link>
          </div>
          <span className={styles.finalNote}>
            No sign-in needed for the demo. Connected beta availability is limited.
          </span>
          <div className={styles.ctaArt} aria-hidden="true">
            <MoveUpRight strokeWidth={0.6} />
          </div>
        </section>
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerTop}>
          <div>
            <Link className={styles.logo} href="/" aria-label="Balance home">
              <span aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              balance.
            </Link>
            <p>A clear head for your whole portfolio.</p>
          </div>
          <nav aria-label="Footer navigation">
            <Link href="/guide">Guide</Link>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy & data</Link>
            <a href="https://github.com/meetgojiya98/SnapTrade" target="_blank" rel="noreferrer">
              Source <ArrowUpRight size={14} />
            </a>
          </nav>
        </div>
        <div className={styles.footerBottom}>
          <span>Balance · An independent portfolio planning tool.</span>
          <p>
            Simulations only. No orders or transfers. Prices may be delayed; fees, taxes, spreads,
            settlement, and FX are not modeled.
          </p>
        </div>
      </footer>
    </div>
  );
}
