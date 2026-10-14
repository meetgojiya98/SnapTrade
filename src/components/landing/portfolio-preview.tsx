'use client';

import { useState } from 'react';
import { ArrowDownRight, ArrowRight, Check, Layers2, ShieldCheck } from 'lucide-react';
import type { Plan } from '@/lib/types';
import styles from './portfolio-preview.module.css';

const categories = [
  { id: 'us-equity', label: 'US equities', color: '#d5f479' },
  { id: 'international', label: 'International', color: '#7ba68d' },
  { id: 'bonds', label: 'Bonds', color: '#d9dfc8' },
  { id: 'cash', label: 'Investable cash', color: '#4b695a' },
] as const;

const dollars = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100);

export default function PortfolioPreview({
  plan,
  totalCents,
  reserveCents,
  accountCount,
}: {
  plan: Plan;
  totalCents: number;
  reserveCents: number;
  accountCount: number;
}) {
  const [after, setAfter] = useState(false);
  const allocations = after ? plan.after : plan.before;
  const investableCash = Math.max(
    0,
    (after ? plan.cashAfterCents : plan.cashBeforeCents) - reserveCents * accountCount,
  );
  const values = categories.map((category) => ({
    ...category,
    percent:
      category.id === 'cash'
        ? plan.totalCents > 0
          ? (investableCash / plan.totalCents) * 100
          : 0
        : allocations.find((allocation) => allocation.assetClass === category.id)?.percent || 0,
  }));
  const circumference = 2 * Math.PI * 78;
  let offset = 0;
  const slices = values
    .filter((value) => value.percent > 0)
    .map((value) => {
      const length = (value.percent / 100) * circumference;
      const slice = { ...value, offset, length };
      offset += length;
      return slice;
    });

  return (
    <div className={styles.visual}>
      <div className={styles.backplate} aria-hidden="true" />
      <section className={styles.preview} aria-label="Sample allocation preview">
        <div className={styles.topbar}>
          <span className={styles.brand}>
            <span className={styles.brandMark} aria-hidden="true">
              b.
            </span>
            Portfolio overview
          </span>
          <span className={styles.sampleTag}>Sample data</span>
        </div>

        <div className={styles.balanceRow}>
          <div className={styles.balance}>
            <span>Total portfolio value</span>
            <strong>
              {dollars(totalCents)}
              <small>.00</small>
            </strong>
          </div>
          <span className={styles.accounts}>
            <Layers2 size={14} aria-hidden="true" />
            {accountCount} accounts
          </span>
        </div>

        <div className={styles.comparison} role="group" aria-label="Sample allocation comparison">
          <button type="button" aria-pressed={!after} onClick={() => setAfter(false)}>
            Before plan
          </button>
          <button type="button" aria-pressed={after} onClick={() => setAfter(true)}>
            After simulation
            <ArrowRight size={12} aria-hidden="true" />
          </button>
        </div>

        <div className={styles.allocation}>
          <div className={styles.ring}>
            <svg
              viewBox="0 0 200 200"
              role="img"
              aria-label={`${after ? 'Simulated' : 'Current'} sample allocation. Percentages are listed alongside.`}
            >
              <circle
                cx="100"
                cy="100"
                r="94"
                fill="none"
                stroke="#486052"
                strokeWidth="0.7"
                strokeDasharray="1 7"
              />
              <circle cx="100" cy="100" r="78" fill="none" stroke="#2b483a" strokeWidth="19" />
              {slices.map((slice) => (
                <circle
                  key={slice.id}
                  cx="100"
                  cy="100"
                  r="78"
                  fill="none"
                  stroke={slice.color}
                  strokeWidth="19"
                  strokeDasharray={`${Math.max(0, slice.length - 5)} ${circumference - Math.max(0, slice.length - 5)}`}
                  strokeDashoffset={-slice.offset + circumference / 4}
                  className={styles.slice}
                />
              ))}
            </svg>
            <div className={styles.ringLabel} aria-live="polite" aria-atomic="true">
              <span>ALLOCATION DRIFT</span>
              <strong>
                {(after ? plan.driftAfter : plan.driftBefore).toFixed(1)}
                <small>pp</small>
              </strong>
              <span className={styles.phase}>{after ? 'After simulation' : 'Before plan'}</span>
            </div>
          </div>
          <div className={styles.legend}>
            <span className={styles.legendTitle}>{after ? 'SIMULATED MIX' : 'CURRENT MIX'}</span>
            {values.map((value) => (
              <div className={styles.legendRow} key={value.id}>
                <span className={styles.colorKey} style={{ background: value.color }} />
                <span>{value.label}</span>
                <strong>{value.percent.toFixed(1)}%</strong>
              </div>
            ))}
            <div className={styles.cashNote}>
              <span>Cash available to plan</span>
              <strong>{dollars(investableCash)}</strong>
            </div>
          </div>
        </div>

        <div className={styles.policy}>
          <span>
            <ShieldCheck size={14} aria-hidden="true" /> {dollars(reserveCents)} reserve / account
          </span>
          <span>
            <Check size={13} aria-hidden="true" /> Taxable sales off
          </span>
        </div>
      </section>

      <div className={styles.planCard}>
        <div className={styles.planCopy}>
          <span className={styles.planIcon}>
            <ArrowDownRight size={19} aria-hidden="true" />
          </span>
          <span>
            <strong>A more balanced next move.</strong>
            <small>{plan.trades.length} proposed moves · whole shares · simulation</small>
          </span>
        </div>
        <div
          className={styles.driftFlow}
          aria-label={`Allocation drift: ${plan.driftBefore.toFixed(1)} percentage points before, ${plan.driftAfter.toFixed(1)} after simulation`}
        >
          <span>{plan.driftBefore.toFixed(1)}</span>
          <ArrowRight size={15} aria-hidden="true" />
          <strong>
            {plan.driftAfter.toFixed(1)}
            <small>pp</small>
          </strong>
        </div>
      </div>
      <p className={styles.footnote}>
        Fictional holdings & prices. Weights exclude protected reserves.
      </p>
    </div>
  );
}
