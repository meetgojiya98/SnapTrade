'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import styles from '@/app/resources.module.css';

const topics = [
  'Connection or sign-in',
  'Portfolio data',
  'Plan calculation',
  'Saved plans or export',
  'Accessibility or interface',
  'Other product feedback',
];
const referencePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export default function SupportReport() {
  const [ready, setReady] = useState(false);
  const [topic, setTopic] = useState(topics[0]);
  const [reference, setReference] = useState('');
  const referenceInput = useRef<HTMLInputElement>(null);
  useEffect(() => setReady(true), []);
  const trimmed = reference.trim();
  const invalid = Boolean(trimmed && !referencePattern.test(trimmed));
  const body = `Topic: ${topic}\nRequest reference: ${trimmed && !invalid ? trimmed : 'Not available'}\n\nWhat happened?\n[Describe the problem without account numbers, balances, holdings, screenshots of private data, or credentials.]\n\nSteps to reproduce\n1. \n2. \n\nExpected behavior\n\nBrowser and device (optional)\n\nPlease review this report before submitting. GitHub issues are public.`;
  const issueUrl = new URL('https://github.com/meetgojiya98/SnapTrade/issues/new');
  issueUrl.searchParams.set('title', `[Balance] ${topic}`);
  issueUrl.searchParams.set('body', body);

  return (
    <section className={styles.report} aria-labelledby="report-title">
      <div className={styles.reportIntro}>
        <span className={styles.eyebrow}>A BETTER BUG REPORT</span>
        <h2 id="report-title">Help us reproduce the problem.</h2>
        <p>
          Prepare a report for the project’s public GitHub issue tracker. If an error includes a
          request reference, include that code so the failure can be traced without sharing your
          portfolio.
        </p>
        <span className={styles.reportNote}>
          <span className={styles.statusDot} /> Your report opens as a draft.
        </span>
      </div>
      <form onSubmit={(event) => event.preventDefault()}>
        <label className={styles.field}>
          What needs attention?
          <select
            disabled={!ready}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          >
            {topics.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className={styles.field}>
          <label htmlFor="request-reference">Request reference (optional)</label>
          <input
            id="request-reference"
            disabled={!ready}
            ref={referenceInput}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={64}
            aria-invalid={invalid}
            aria-describedby="reference-help"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <small id="reference-help" className={invalid ? styles.validation : undefined}>
            {invalid
              ? 'Use only the reference code shown with the error, or leave this empty.'
              : 'Paste only the error’s reference code. No account details or credentials.'}
          </small>
        </div>
        <div className={styles.formBottom}>
          <a
            className={styles.primary}
            href={ready ? issueUrl.toString() : undefined}
            aria-disabled={!ready}
            tabIndex={ready ? undefined : -1}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (invalid) {
                event.preventDefault();
                referenceInput.current?.focus();
              }
            }}
          >
            Review issue draft on GitHub <ArrowUpRight size={16} />
          </a>
          <p>
            This opens a draft in a new tab. You review and submit it yourself. GitHub issues are
            public; never include financial data or secrets.
          </p>
        </div>
        <noscript>
          <p>
            Enable JavaScript to prepare a reference-based draft, or{' '}
            <a
              href="https://github.com/meetgojiya98/SnapTrade/issues/new"
              target="_blank"
              rel="noreferrer"
            >
              write a public issue on GitHub
            </a>
            . Do not include financial data or credentials.
          </p>
        </noscript>
      </form>
    </section>
  );
}
