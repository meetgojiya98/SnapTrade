import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import PublicShell from '@/components/public-shell';
import styles from './resources.module.css';

export default function NotFound() {
  return (
    <PublicShell>
      <div className={`${styles.hero} ${styles.errorHero}`}>
        <div className={`${styles.intro} ${styles.error}`}>
          <span className={styles.eyebrow}>
            <span>404 /</span> Page not found
          </span>
          <h1>A little off course.</h1>
          <p>
            This page may have moved, or the address may be incomplete. Return to Balance or pick up
            where you left off in your workspace.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/">
              Back to Balance <ArrowRight size={17} />
            </Link>
            <Link className={styles.secondary} href="/app">
              Open workspace
            </Link>
          </div>
        </div>
        <div className={`${styles.heroAside} ${styles.errorVisual}`} aria-hidden="true">
          <span className={styles.errorCoordinate}>BALANCE / FIND YOUR WAY</span>
          <span className={styles.errorNumber}>
            404<span>↗</span>
          </span>
          <span className={styles.errorCoordinate}>A clearer perspective is a click away.</span>
        </div>
      </div>
    </PublicShell>
  );
}
