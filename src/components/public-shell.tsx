import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import styles from './public-shell.module.css';

export default function PublicShell({
  children,
  currentPage,
}: {
  children: React.ReactNode;
  currentPage?: 'guide' | 'support' | 'privacy';
}) {
  return (
    <div className={styles.page}>
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Balance home">
          <span className={styles.mark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          balance.
        </Link>
        <nav aria-label="Resources navigation">
          <Link href="/demo">Interactive demo</Link>
          <Link href="/guide" aria-current={currentPage === 'guide' ? 'page' : undefined}>
            Guide
          </Link>
          <Link href="/support" aria-current={currentPage === 'support' ? 'page' : undefined}>
            Support
          </Link>
          <Link href="/privacy" aria-current={currentPage === 'privacy' ? 'page' : undefined}>
            Privacy
          </Link>
        </nav>
        <div className={styles.headerActions}>
          <Link href="/signin" className={styles.signIn}>
            Sign in
          </Link>
          <Link href="/app" className={styles.workspace}>
            Open workspace <ArrowUpRight size={15} />
          </Link>
        </div>
      </header>
      <main className={styles.main} id="content" tabIndex={-1}>
        {children}
      </main>
      <footer className={styles.footer}>
        <div className={styles.footerIdentity}>
          <Link href="/" className={styles.brand}>
            <span className={styles.mark} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            balance.
          </Link>
          <p>
            A considered plan.
            <br />
            Every decision yours.
          </p>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/demo">Interactive demo</Link>
          <Link href="/guide">Guide</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
        </nav>
        <span className={styles.footerNote}>A clearer perspective.</span>
      </footer>
    </div>
  );
}
