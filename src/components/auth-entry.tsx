import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Check, LockKeyhole, ShieldCheck } from 'lucide-react';
import PublicShell from '@/components/public-shell';
import styles from './auth-entry.module.css';

export default function AuthEntry({ mode }: { mode: 'signin' | 'signup' }) {
  const signingUp = mode === 'signup';
  return (
    <PublicShell>
      <div className={styles.layout}>
        <div className={styles.intro}>
          <span className={styles.eyebrow}>YOUR BALANCE WORKSPACE</span>
          <h1>{signingUp ? 'Create your Balance workspace.' : 'Sign in to Balance.'}</h1>
          <p>
            {signingUp
              ? 'Start with a SnapTrade Personal account. Then authorize Balance to bring your shared accounts into a workspace built around your own planning decisions.'
              : 'Use your SnapTrade Personal account to return to your saved preferences, plan history, and private support conversations.'}
          </p>
          <ul className={styles.benefits} aria-label="Your connected workspace">
            <li>
              <Check size={17} aria-hidden="true" />
              Your accounts, together in one planning view
            </li>
            <li>
              <Check size={17} aria-hidden="true" />
              Your target mix and cash reserve
            </li>
            <li>
              <Check size={17} aria-hidden="true" />
              Saved simulations with their original context
            </li>
          </ul>
          <div className={styles.sample}>
            <strong>Explore first, without connecting.</strong>
            <p>The interactive demo uses fictional holdings and needs no account.</p>
            <Link href="/demo">
              Try the interactive demo <ArrowRight size={15} aria-hidden="true" />
            </Link>
          </div>
        </div>

        <section className={styles.card} aria-labelledby="auth-title">
          <nav className={styles.tabs} aria-label="Account access">
            <Link href="/signin" aria-current={!signingUp ? 'page' : undefined}>
              Sign in
            </Link>
            <Link href="/signup" aria-current={signingUp ? 'page' : undefined}>
              Create workspace
            </Link>
          </nav>
          <span className={styles.icon}>
            <LockKeyhole size={21} aria-hidden="true" />
          </span>
          <h2 id="auth-title">
            {signingUp
              ? 'One identity. Your own workspace.'
              : 'Continue with your SnapTrade identity.'}
          </h2>
          <p className={styles.description}>
            {signingUp
              ? 'Your first authorized sign-in opens your Balance workspace. SnapTrade handles account registration and sign-in; you do not need a separate Balance password.'
              : 'Sign in happens at SnapTrade. Choose the same Personal identity you used before to restore your Balance workspace.'}
          </p>

          {signingUp ? (
            <ol className={styles.steps} aria-label="Create your connected workspace">
              <li>
                <span>1</span>
                <div>
                  <strong>Set up SnapTrade Personal</strong>
                  <p>
                    Open the dashboard, choose Personal, sign up, and verify your email. Connect a
                    brokerage there before returning to Balance.
                  </p>
                  <a href="https://dashboard.snaptrade.com" target="_blank" rel="noreferrer">
                    Open SnapTrade Personal <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                  <a
                    className={styles.setupGuide}
                    href="https://snaptrade.com/personal-account-setup"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Follow SnapTrade’s account setup guide{' '}
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </a>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Return and authorize Balance</strong>
                  <p>
                    Already have a Personal account? Continue below. Review the requested sign-in
                    and account read access at SnapTrade.
                  </p>
                </div>
              </li>
            </ol>
          ) : null}

          <a className={styles.primary} href="/api/auth/login">
            {signingUp ? 'Create workspace with SnapTrade' : 'Sign in with SnapTrade'}{' '}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
          <p className={styles.redirectNote}>
            Opens SnapTrade sign-in and consent. You return to your workspace after approval.
          </p>

          <div className={styles.consent}>
            <ShieldCheck size={17} aria-hidden="true" />
            <div>
              <strong>Review the beta consent screen</strong>
              <p>
                It currently shows <b>“CIBC”</b>, this project’s SnapTrade registration name.
                Balance is an independent beta and is not affiliated with the bank. It requests
                sign-in and read access only; it cannot place trades.
              </p>
            </div>
          </div>
          <p className={styles.beta}>
            <strong>Connected beta:</strong> up to 5 users while SnapTrade production approval is
            pending. If access is unavailable, <Link href="/demo">try the interactive demo</Link> or{' '}
            <Link href="/support">get help</Link>.
          </p>
          <div className={styles.otherPaths}>
            {signingUp ? (
              <p>
                Already use Balance? <Link href="/signin">Sign in instead</Link>.
              </p>
            ) : (
              <p>
                New to Balance? <Link href="/signup">Create your workspace</Link>.
              </p>
            )}
            <p>
              Already connected in this browser? <Link href="/app">Open your workspace</Link>.
            </p>
          </div>
          <p className={styles.privacy}>
            Read how connection credentials and saved data are handled in our{' '}
            <Link href="/privacy">privacy policy</Link>.
          </p>
        </section>
      </div>
    </PublicShell>
  );
}
