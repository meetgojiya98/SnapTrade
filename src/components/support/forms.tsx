'use client';

import type { FormEvent } from 'react';
import { Send } from 'lucide-react';
import { supportLimits, supportTopics, type SupportTopic } from '@/lib/support';
import styles from './support.module.css';

export const topicLabels: Record<SupportTopic, string> = {
  connection: 'Connection or sign-in',
  portfolio: 'Portfolio data',
  planning: 'Plan calculation',
  'saved-plans': 'Saved plans or export',
  privacy: 'Privacy or data removal',
  other: 'Other product question',
};

export interface RequestDraft {
  topic: SupportTopic;
  title: string;
  message: string;
  reference: string;
  clientRequestId: string | null;
}

export interface ReplyDraft {
  message: string;
  clientRequestId: string | null;
}

export const emptyRequestDraft = (): RequestDraft => ({
  topic: 'connection',
  title: '',
  message: '',
  reference: '',
  clientRequestId: null,
});

export const referencePattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function RequestForm({
  draft,
  onChange,
  onSubmit,
  disabled,
  sending,
}: {
  draft: RequestDraft;
  onChange: (value: Partial<RequestDraft>) => void;
  onSubmit: () => void;
  disabled: boolean;
  sending: boolean;
}) {
  const invalidReference = Boolean(
    draft.reference.trim() && !referencePattern.test(draft.reference.trim()),
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled && !invalidReference && draft.title.trim() && draft.message.trim()) onSubmit();
  };
  return (
    <form onSubmit={submit} aria-label="New private support request">
      <label className={styles.field}>
        What needs attention?
        <select
          value={draft.topic}
          disabled={disabled}
          onChange={(event) => onChange({ topic: event.target.value as SupportTopic })}
        >
          {supportTopics.map((topic) => (
            <option key={topic} value={topic}>
              {topicLabels[topic]}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        Request title
        <input
          value={draft.title}
          disabled={disabled}
          required
          maxLength={supportLimits.maxTitleLength}
          onChange={(event) => onChange({ title: event.target.value })}
          autoComplete="off"
          placeholder="A short description of the problem"
        />
      </label>
      <div className={styles.field}>
        <label htmlFor="support-new-message">What happened?</label>
        <textarea
          id="support-new-message"
          value={draft.message}
          disabled={disabled}
          required
          maxLength={supportLimits.maxMessageLength}
          onChange={(event) => onChange({ message: event.target.value })}
          aria-describedby="support-message-help"
          placeholder="Describe the issue, what you tried, and what you expected."
        />
        <small id="support-message-help">
          {draft.message.length.toLocaleString()} /{' '}
          {supportLimits.maxMessageLength.toLocaleString()} characters. Do not include passwords,
          access tokens, full account numbers, or portfolio screenshots.
        </small>
      </div>
      <div className={styles.field}>
        <label htmlFor="support-new-reference">Error request reference (optional)</label>
        <input
          id="support-new-reference"
          value={draft.reference}
          disabled={disabled}
          onChange={(event) => onChange({ reference: event.target.value })}
          maxLength={64}
          aria-invalid={invalidReference}
          aria-describedby="support-reference-help"
          autoComplete="off"
          spellCheck={false}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        />
        <small
          id="support-reference-help"
          className={invalidReference ? styles.validation : undefined}
        >
          {invalidReference
            ? 'Use the reference code shown with the error, or leave this empty.'
            : 'Paste only the reference code shown with an error. This helps trace the failure.'}
        </small>
      </div>
      <div className={styles.formBottom}>
        <button
          className={styles.primary}
          disabled={disabled || invalidReference || !draft.title.trim() || !draft.message.trim()}
          type="submit"
        >
          <Send size={15} aria-hidden="true" />{' '}
          {sending ? 'Sending request…' : 'Send private request'}
        </button>
        <small>Drafts stay in this page until sent. Leaving or reloading clears them.</small>
      </div>
    </form>
  );
}

export function ReplyForm({
  draft,
  onChange,
  onSubmit,
  disabled,
  sending,
  operator,
}: {
  draft: ReplyDraft;
  onChange: (message: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  sending: boolean;
  operator: boolean;
}) {
  return (
    <form
      className={styles.reply}
      aria-label="Reply to support request"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && draft.message.trim()) onSubmit();
      }}
    >
      <div className={styles.field}>
        <label htmlFor="support-reply-message">
          {operator ? 'Reply to the customer' : 'Your reply'}
        </label>
        <textarea
          id="support-reply-message"
          value={draft.message}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          required
          maxLength={supportLimits.maxMessageLength}
          aria-describedby="support-reply-help"
        />
        <small id="support-reply-help">
          {draft.message.length.toLocaleString()} /{' '}
          {supportLimits.maxMessageLength.toLocaleString()} characters. Keep credentials and full
          account numbers out of this conversation.
        </small>
      </div>
      <div className={styles.formBottom}>
        <button
          className={styles.primary}
          type="submit"
          disabled={disabled || !draft.message.trim()}
        >
          <Send size={15} aria-hidden="true" /> {sending ? 'Sending reply…' : 'Send reply'}
        </button>
        <small>Your draft is preserved if sending fails.</small>
      </div>
    </form>
  );
}
