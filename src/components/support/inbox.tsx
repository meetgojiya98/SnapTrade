'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  LockKeyhole,
  MessageCircle,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import {
  supportLimits,
  type SupportCollection,
  type SupportRole,
  type SupportThread,
  type SupportThreadSummary,
} from '@/lib/support';
import {
  emptyRequestDraft,
  referencePattern,
  ReplyForm,
  RequestForm,
  topicLabels,
  type ReplyDraft,
} from './forms';
import styles from './support.module.css';

type Scope = 'mine' | 'all';
type Pending = 'create' | 'reply' | 'status' | 'delete' | 'delete-all' | null;

class SupportFailure extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly reference: string | null = null,
    readonly retryAfter: number | null = null,
  ) {
    super(message);
  }
}

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new SupportFailure(
      'The connection was interrupted. Your draft is still here. Try again when you are connected.',
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const candidate = data?.requestId ?? response.headers.get('x-request-id');
    const reference =
      typeof candidate === 'string' && referencePattern.test(candidate) ? candidate : null;
    const retry = Number(response.headers.get('retry-after'));
    throw new SupportFailure(
      typeof data?.error === 'string'
        ? data.error
        : 'Support could not complete this request. Please try again.',
      response.status,
      reference,
      Number.isFinite(retry) && retry > 0 ? retry : null,
    );
  }
  if (data === null || typeof data !== 'object')
    throw new SupportFailure('Support returned an incomplete response. Please try again.');
  return data as T;
}

const failure = (error: unknown): SupportFailure =>
  error instanceof SupportFailure
    ? error
    : new SupportFailure('Support could not complete this request. Please try again.');
const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const summary = ({ messages: _messages, ...thread }: SupportThread): SupportThreadSummary => thread;
const mergeThreads = (previous: SupportThreadSummary[], incoming: SupportThreadSummary[]) =>
  [...new Map([...previous, ...incoming].map((thread) => [thread.id, thread])).values()].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id),
  );

function ErrorNotice({
  error,
  retry,
  retryLabel = 'Try again',
  disabled = false,
}: {
  error: SupportFailure;
  retry?: () => void;
  retryLabel?: string;
  disabled?: boolean;
}) {
  return (
    <div className={styles.error} role="alert">
      <p>{error.message}</p>
      {error.retryAfter ? (
        <p>Wait about {Math.ceil(error.retryAfter / 60)} minute(s) before retrying.</p>
      ) : null}
      {error.reference ? (
        <span className={styles.reference}>
          Request reference: <code>{error.reference}</code>
        </span>
      ) : null}
      {retry ? (
        <button className={styles.secondary} onClick={retry} disabled={disabled}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export default function SupportInbox() {
  const [access, setAccess] = useState<'loading' | 'connected' | 'anonymous' | 'failed'>('loading');
  const [role, setRole] = useState<SupportRole>('customer');
  const [viewerKey, setViewerKey] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const [accepting, setAccepting] = useState(false);
  const [scope, setScope] = useState<Scope>('mine');
  const [threads, setThreads] = useState<SupportThreadSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [listError, setListError] = useState<SupportFailure | null>(null);
  const [detailError, setDetailError] = useState<SupportFailure | null>(null);
  const [actionError, setActionError] = useState<SupportFailure | null>(null);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [draft, setDraft] = useState(emptyRequestDraft);
  const [replies, setReplies] = useState<Record<string, ReplyDraft>>({});
  const listVersion = useRef(0);
  const detailVersion = useRef(0);
  const identityVersion = useRef(0);
  const viewerIdentity = useRef<string | null>(null);
  const selected = useRef<string | null>(null);
  const creating = useRef(false);
  const mutation = useRef(false);
  const mounted = useRef(true);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  const unauthorized = useCallback(() => {
    identityVersion.current += 1;
    viewerIdentity.current = null;
    listVersion.current += 1;
    detailVersion.current += 1;
    selected.current = null;
    creating.current = false;
    setAccess('anonymous');
    setRole('customer');
    setViewerKey(null);
    setCopyNotice('');
    setAccepting(false);
    setThreads([]);
    setThread(null);
    setSelectedId(null);
    setShowNew(false);
    setNextCursor(null);
    setScope('mine');
    setListLoading(false);
    setDetailLoading(false);
    setDraft(emptyRequestDraft());
    setReplies({});
    setActionError(null);
    setListError(null);
    setDetailError(null);
    setNotice('');
  }, []);

  const loadDetail = useCallback(
    async (id: string, moveFocus = false) => {
      const version = ++detailVersion.current;
      setDetailLoading(true);
      setDetailError(null);
      setThread(null);
      try {
        const data = await request<{ thread: SupportThread }>(
          `/api/support/${encodeURIComponent(id)}`,
        );
        if (!data.thread || !Array.isArray(data.thread.messages))
          throw new SupportFailure('This conversation could not be loaded. Please try again.');
        if (!mounted.current || version !== detailVersion.current) return;
        setThread(data.thread);
        setThreads((current) => mergeThreads(current, [summary(data.thread)]));
        if (moveFocus) requestAnimationFrame(() => detailHeading.current?.focus());
      } catch (error) {
        if (!mounted.current || version !== detailVersion.current) return;
        const value = failure(error);
        if (value.status === 401) unauthorized();
        else setDetailError(value);
      } finally {
        if (mounted.current && version === detailVersion.current) setDetailLoading(false);
      }
    },
    [unauthorized],
  );

  const loadList = useCallback(
    async function loadCollection(target: Scope, cursor?: string): Promise<void> {
      const version = ++listVersion.current;
      setListLoading(true);
      setListError(null);
      try {
        const query = new URLSearchParams({ scope: target });
        if (cursor) query.set('cursor', cursor);
        const data = await request<SupportCollection>(`/api/support?${query}`);
        if (
          !Array.isArray(data.threads) ||
          !['customer', 'operator'].includes(data.role) ||
          typeof data.viewerKey !== 'string' ||
          !/^[a-f0-9]{64}$/.test(data.viewerKey)
        )
          throw new SupportFailure('Your requests could not be loaded. Please try again.');
        if (!mounted.current || version !== listVersion.current) return;
        // Another tab can change the session without a local 401. Never carry the previous
        // identity's selection, conversation, or drafts into a newly authenticated inbox.
        const identityChanged = Boolean(
          viewerIdentity.current && viewerIdentity.current !== data.viewerKey,
        );
        if (identityChanged) {
          identityVersion.current += 1;
          detailVersion.current += 1;
          selected.current = null;
          creating.current = false;
          setSelectedId(null);
          setThread(null);
          setThreads([]);
          setNextCursor(null);
          setShowNew(false);
          setDetailLoading(false);
          setDetailError(null);
          setActionError(null);
          setNotice('');
          setDraft(emptyRequestDraft());
          setReplies({});
          setCopyNotice('');
        }
        viewerIdentity.current = data.viewerKey;
        setRole(data.role);
        setViewerKey(data.viewerKey);
        setAccepting(data.acceptingRequests === true);
        // Pagination boundaries belong to the old inbox. Restart from the first page.
        if (identityChanged && cursor) {
          await loadCollection(target);
          return;
        }
        setThreads((current) => (cursor ? mergeThreads(current, data.threads) : data.threads));
        setNextCursor(data.nextCursor);
        setAccess('connected');
        if (!cursor && !selected.current && !creating.current) {
          if (data.threads.length) {
            selected.current = data.threads[0].id;
            setSelectedId(data.threads[0].id);
            void loadDetail(data.threads[0].id);
          } else if (target === 'mine' && data.acceptingRequests) {
            creating.current = true;
            setShowNew(true);
          }
        }
      } catch (error) {
        if (!mounted.current || version !== listVersion.current) return;
        const value = failure(error);
        if (value.status === 401) unauthorized();
        else {
          setListError(value);
          setAccess((current) => (current === 'connected' ? current : 'failed'));
          if (value.status === 403 && target === 'all') {
            identityVersion.current += 1;
            setRole('customer');
            setAccepting(false);
            setScope('mine');
            setThreads([]);
            setThread(null);
            selected.current = null;
            setSelectedId(null);
            detailVersion.current += 1;
            setDetailLoading(false);
            setReplies({});
          }
        }
      } finally {
        if (mounted.current && version === listVersion.current) setListLoading(false);
      }
    },
    [loadDetail, unauthorized],
  );

  useEffect(() => {
    mounted.current = true;
    void loadList('mine');
    return () => {
      mounted.current = false;
      identityVersion.current += 1;
      listVersion.current += 1;
      detailVersion.current += 1;
    };
  }, [loadList]);

  const hasDraft = Boolean(
    draft.title.trim() ||
    draft.message.trim() ||
    draft.reference.trim() ||
    Object.values(replies).some((reply) => reply.message.trim()),
  );
  useEffect(() => {
    if (!hasDraft) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const beforeNavigate = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const next = new URL(anchor.href, window.location.href);
      if (
        next.origin === window.location.origin &&
        next.pathname === window.location.pathname &&
        next.search === window.location.search
      )
        return;
      if (!window.confirm('You have an unsent support draft. Leave this page and discard it?')) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', beforeNavigate, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', beforeNavigate, true);
    };
  }, [hasDraft]);

  const viewThread = (id: string) => {
    selected.current = id;
    creating.current = false;
    setSelectedId(id);
    setShowNew(false);
    setActionError(null);
    setNotice('');
    void loadDetail(id, true);
  };

  const changeScope = (target: Scope) => {
    if (mutation.current || target === scope) return;
    selected.current = null;
    creating.current = false;
    detailVersion.current += 1;
    setSelectedId(null);
    setThread(null);
    setThreads([]);
    setNextCursor(null);
    setShowNew(false);
    setDetailError(null);
    setActionError(null);
    setNotice('');
    setScope(target);
    void loadList(target);
  };

  const refresh = () => {
    void loadList(scope);
    if (selected.current) void loadDetail(selected.current);
  };

  const applyThread = (value: SupportThread) => {
    detailVersion.current += 1;
    selected.current = value.id;
    creating.current = false;
    setSelectedId(value.id);
    setShowNew(false);
    setThread(value);
    setDetailError(null);
    setDetailLoading(false);
    setThreads((current) => mergeThreads(current, [summary(value)]));
  };

  const runMutation = async (
    kind: Exclude<Pending, null>,
    work: (isCurrent: () => boolean) => Promise<void>,
  ) => {
    if (mutation.current) return;
    const version = identityVersion.current;
    const isCurrent = () => mounted.current && version === identityVersion.current;
    mutation.current = true;
    setPending(kind);
    setActionError(null);
    setNotice('');
    try {
      await work(isCurrent);
    } catch (error) {
      if (!isCurrent()) return;
      const value = failure(error);
      if (value.status === 401) unauthorized();
      else setActionError(value);
    } finally {
      mutation.current = false;
      if (mounted.current) setPending(null);
    }
  };

  const createRequest = () => {
    if (mutation.current) return;
    const clientRequestId = draft.clientRequestId ?? crypto.randomUUID();
    setDraft((current) => ({ ...current, clientRequestId }));
    void runMutation('create', async (isCurrent) => {
      const { thread: saved } = await request<{ thread: SupportThread }>('/api/support', 'POST', {
        clientRequestId,
        topic: draft.topic,
        title: draft.title.trim(),
        message: draft.message.trim(),
        requestReference: draft.reference.trim() || null,
      });
      if (!isCurrent()) return;
      applyThread(saved);
      setDraft(emptyRequestDraft());
      setNotice('Your private request was sent. Return here for replies.');
      requestAnimationFrame(() => detailHeading.current?.focus());
    });
  };

  const sendReply = () => {
    if (!thread || mutation.current) return;
    const id = thread.id;
    const reply = replies[id] ?? { message: '', clientRequestId: null };
    const clientRequestId = reply.clientRequestId ?? crypto.randomUUID();
    setReplies((current) => ({ ...current, [id]: { ...reply, clientRequestId } }));
    void runMutation('reply', async (isCurrent) => {
      const { thread: updated } = await request<{ thread: SupportThread }>(
        `/api/support/${id}/messages`,
        'POST',
        { clientRequestId, message: reply.message.trim() },
      );
      if (!isCurrent()) return;
      applyThread(updated);
      setReplies((current) => ({ ...current, [id]: { message: '', clientRequestId: null } }));
      setNotice('Your reply was sent.');
    });
  };

  const changeStatus = () => {
    if (!thread) return;
    const status = thread.status === 'open' ? 'resolved' : 'open';
    void runMutation('status', async (isCurrent) => {
      const { thread: updated } = await request<{ thread: SupportThread }>(
        `/api/support/${thread.id}`,
        'PATCH',
        { status },
      );
      if (!isCurrent()) return;
      applyThread(updated);
      setNotice(
        status === 'resolved'
          ? 'This request is marked resolved. You can reopen it if you need more help.'
          : 'This request is open again.',
      );
    });
  };

  const removeRequest = () => {
    if (
      !thread ||
      !thread.canDelete ||
      !window.confirm('Delete this support request and all of its messages? This cannot be undone.')
    )
      return;
    const id = thread.id;
    void runMutation('delete', async (isCurrent) => {
      await request(`/api/support/${id}`, 'DELETE');
      if (!isCurrent()) return;
      const remaining = threads.filter((item) => item.id !== id);
      setThreads(remaining);
      setThread(null);
      setSelectedId(null);
      selected.current = null;
      setReplies((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setNotice('The support request and its messages were deleted.');
      if (remaining.length) {
        selected.current = remaining[0].id;
        setSelectedId(remaining[0].id);
        void loadDetail(remaining[0].id);
      } else if (scope === 'mine' && accepting) {
        creating.current = true;
        setShowNew(true);
      }
    });
  };

  const removeAll = () => {
    if (
      !window.confirm(
        'Delete all of your support requests and messages? This does not delete workspace preferences or saved plans and cannot be undone.',
      )
    )
      return;
    void runMutation('delete-all', async (isCurrent) => {
      await request('/api/support', 'DELETE');
      if (!isCurrent()) return;
      detailVersion.current += 1;
      selected.current = null;
      creating.current = accepting;
      setThreads([]);
      setNextCursor(null);
      setThread(null);
      setSelectedId(null);
      setShowNew(accepting);
      setReplies({});
      setNotice('All of your support requests and messages were deleted.');
    });
  };

  const busy = pending !== null || listLoading || detailLoading;
  const reply = thread ? (replies[thread.id] ?? { message: '', clientRequestId: null }) : null;
  const operatorView = scope === 'all' && role === 'operator';

  return (
    <section className={styles.root} aria-label="Private support">
      <div className={styles.intro}>
        <span className={styles.eyebrow}>
          <LockKeyhole size={14} aria-hidden="true" /> Private in-app support
        </span>
        <h1>{operatorView ? 'Operator inbox.' : 'Your support conversations.'}</h1>
        <p>
          {operatorView
            ? 'Review customer requests and reply here. Access is restricted to approved support operators.'
            : 'Send a product question and keep the conversation in Balance. Only your signed-in account and approved support operators can read it.'}{' '}
          For connection walkthroughs and common issues, visit{' '}
          <Link href="/support">Help & support</Link>.
        </p>
      </div>

      {access === 'loading' ? (
        <div className={styles.loading} role="status">
          <div className={styles.loadingBar} aria-hidden="true" />
          <div className={styles.loadingBar} aria-hidden="true" />
          Loading private support…
        </div>
      ) : null}
      {access === 'anonymous' ? (
        <div className={styles.gate}>
          <h2>Connect to open your private support.</h2>
          <p>
            Sign in through your Balance workspace, then return here. Your requests follow that same
            SnapTrade Personal identity.
          </p>
          <div className={styles.actions}>
            <Link href="/app" className={styles.primary}>
              Open workspace to sign in <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <button className={styles.secondary} onClick={() => void loadList('mine')}>
              I signed in, try again
            </button>
          </div>
          <p>
            Having trouble signing in? The <Link href="/support">public support guidance</Link> and
            GitHub product issue draft are available without a connection. Keep private data out of
            public issues.
          </p>
        </div>
      ) : null}
      {access === 'failed' && listError ? (
        <ErrorNotice
          error={listError}
          retry={() => void loadList(scope)}
          retryLabel="Retry private support"
          disabled={listLoading || pending !== null}
        />
      ) : null}

      {access === 'connected' ? (
        <>
          <div className={styles.toolbar}>
            {role === 'operator' ? (
              <div className={styles.tabs} aria-label="Support inbox scope">
                <button
                  aria-pressed={scope === 'mine'}
                  onClick={() => changeScope('mine')}
                  disabled={busy}
                >
                  My requests
                </button>
                <button
                  aria-pressed={scope === 'all'}
                  onClick={() => changeScope('all')}
                  disabled={busy}
                >
                  Operator inbox
                </button>
              </div>
            ) : (
              <span className={styles.muted}>Refresh to check for new replies.</span>
            )}
            <div className={styles.actions}>
              <button className={styles.secondary} disabled={busy} onClick={refresh}>
                <RefreshCw size={14} aria-hidden="true" />
                {listLoading ? 'Refreshing requests…' : 'Refresh requests'}
              </button>
              {scope === 'mine' ? (
                <button
                  className={styles.primary}
                  disabled={busy || !accepting}
                  onClick={() => {
                    selected.current = null;
                    creating.current = true;
                    detailVersion.current += 1;
                    setSelectedId(null);
                    setThread(null);
                    setShowNew(true);
                    setActionError(null);
                    setDetailError(null);
                    setNotice('');
                  }}
                >
                  <Plus size={15} aria-hidden="true" />
                  New request
                </button>
              ) : null}
            </div>
          </div>
          {!accepting ? (
            <div className={styles.notice} role="status">
              <strong>Private support is not accepting new messages right now.</strong> Existing
              requests remain available to read and delete. Use the{' '}
              <Link href="/support">self-help guidance</Link> or a public GitHub issue for
              non-sensitive product reports.
            </div>
          ) : null}
          {notice ? (
            <div className={styles.success} role="status">
              {notice}
            </div>
          ) : null}
          {listError ? (
            <ErrorNotice
              error={listError}
              retry={() => void loadList(scope)}
              retryLabel="Retry request list"
              disabled={listLoading || pending !== null}
            />
          ) : null}
          {actionError ? <ErrorNotice error={actionError} /> : null}
          <div className={styles.layout}>
            <aside
              className={styles.list}
              aria-label={operatorView ? 'Customer support requests' : 'Your support requests'}
            >
              <div className={styles.listHeading}>
                <h2>{operatorView ? 'Customer requests' : 'Your requests'}</h2>
                <span>{threads.length} loaded</span>
              </div>
              {threads.length ? (
                <div
                  className={styles.requestList}
                  role="region"
                  aria-label="Support request list"
                  tabIndex={0}
                >
                  {threads.map((item) => (
                    <button
                      key={item.id}
                      className={styles.request}
                      disabled={pending !== null}
                      aria-pressed={selectedId === item.id && !showNew}
                      onClick={() => viewThread(item.id)}
                    >
                      <strong>{item.title}</strong>
                      <span
                        className={`${styles.requestStatus} ${item.status === 'resolved' ? styles.resolved : ''}`}
                      >
                        {item.status === 'open' ? 'Open' : 'Resolved'}
                      </span>
                      <small>
                        {item.messageCount} message{item.messageCount === 1 ? '' : 's'} ·{' '}
                        {item.lastMessageRole === 'operator'
                          ? 'Support replied'
                          : 'Customer message'}
                        <br />
                        <time dateTime={item.updatedAt}>{dateLabel(item.updatedAt)}</time>
                      </small>
                    </button>
                  ))}
                </div>
              ) : (
                <p className={styles.empty}>
                  {listLoading
                    ? 'Loading requests…'
                    : operatorView
                      ? 'No customer requests to review.'
                      : 'No support requests yet. Your conversations will appear here.'}
                </p>
              )}
              {nextCursor ? (
                <button
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => void loadList(scope, nextCursor)}
                >
                  {listLoading ? 'Loading more…' : 'Load more requests'}
                </button>
              ) : null}
              {scope === 'mine' && threads.length ? (
                <button className={styles.textButton} disabled={busy} onClick={removeAll}>
                  <Trash2 size={13} aria-hidden="true" />
                  {pending === 'delete-all'
                    ? 'Deleting requests…'
                    : 'Delete all my support requests'}
                </button>
              ) : null}
            </aside>
            <div className={styles.panel} aria-busy={detailLoading || pending !== null}>
              {showNew && scope === 'mine' && accepting ? (
                <>
                  <h2>New private request</h2>
                  <p className={styles.muted}>
                    Tell us what is getting in the way. This conversation is kept inside Balance.
                  </p>
                  <RequestForm
                    draft={draft}
                    disabled={busy}
                    sending={pending === 'create'}
                    onChange={(change) =>
                      setDraft((current) => ({ ...current, ...change, clientRequestId: null }))
                    }
                    onSubmit={createRequest}
                  />
                </>
              ) : detailLoading ? (
                <p className={styles.loading} role="status">
                  Loading conversation…
                </p>
              ) : detailError ? (
                <ErrorNotice
                  error={detailError}
                  retry={selectedId ? () => void loadDetail(selectedId) : undefined}
                  retryLabel="Retry conversation"
                  disabled={busy}
                />
              ) : thread ? (
                <>
                  <div className={styles.titleRow}>
                    <h2 tabIndex={-1} ref={detailHeading}>
                      {thread.title}
                    </h2>
                    <span
                      className={`${styles.badge} ${thread.status === 'resolved' ? styles.resolved : ''}`}
                    >
                      {thread.status === 'open' ? 'Open' : 'Resolved'}
                    </span>
                  </div>
                  <div className={styles.ticketMeta}>
                    <span>{topicLabels[thread.topic]}</span>
                    <span>
                      Created <time dateTime={thread.createdAt}>{dateLabel(thread.createdAt)}</time>
                    </span>
                    <span>
                      Request <code>{thread.id}</code>
                    </span>
                    {thread.requestReference ? (
                      <span>
                        Error reference <code>{thread.requestReference}</code>
                      </span>
                    ) : null}
                  </div>
                  <div className={styles.actions}>
                    <button
                      className={styles.secondary}
                      disabled={busy || (!accepting && thread.status === 'resolved')}
                      onClick={changeStatus}
                    >
                      <Check size={14} aria-hidden="true" />
                      {pending === 'status'
                        ? 'Updating request…'
                        : thread.status === 'open'
                          ? 'Mark resolved'
                          : 'Reopen request'}
                    </button>
                    {thread.canDelete ? (
                      <button className={styles.textButton} disabled={busy} onClick={removeRequest}>
                        <Trash2 size={14} aria-hidden="true" />
                        {pending === 'delete' ? 'Deleting request…' : 'Delete request'}
                      </button>
                    ) : null}
                  </div>
                  <div className={styles.messages} role="region" aria-label="Support conversation">
                    {thread.messages.map((message) => (
                      <article
                        key={message.id}
                        className={`${styles.message} ${message.author === 'operator' ? styles.operatorMessage : ''}`}
                      >
                        <div className={styles.messageMeta}>
                          <strong>
                            {message.author === 'operator'
                              ? 'Balance support'
                              : operatorView
                                ? 'Customer'
                                : 'You'}
                          </strong>
                          <time dateTime={message.createdAt}>{dateLabel(message.createdAt)}</time>
                        </div>
                        <p>{message.body}</p>
                      </article>
                    ))}
                  </div>
                  {thread.status === 'resolved' ? (
                    <p className={styles.notice}>
                      This request is resolved. Reopen it to continue the conversation.
                    </p>
                  ) : thread.messageCount >= supportLimits.maxMessages ? (
                    <p className={styles.notice}>
                      This conversation has reached its {supportLimits.maxMessages}-message limit.
                      {operatorView
                        ? ' Ask the customer to open a new request if they need more help.'
                        : ' Create a new request if you need more help.'}
                    </p>
                  ) : accepting && reply ? (
                    <ReplyForm
                      draft={reply}
                      operator={operatorView}
                      disabled={busy}
                      sending={pending === 'reply'}
                      onChange={(message) =>
                        setReplies((current) => ({
                          ...current,
                          [thread.id]: { message, clientRequestId: null },
                        }))
                      }
                      onSubmit={sendReply}
                    />
                  ) : null}
                  <p className={styles.privacy}>
                    Scheduled removal:{' '}
                    <time dateTime={thread.expiresAt}>{dateLabel(thread.expiresAt)}</time>. Activity
                    extends this date to {supportLimits.retentionDays} days after the latest update.
                  </p>
                </>
              ) : (
                <>
                  <MessageCircle size={25} aria-hidden="true" />
                  <h2>
                    {operatorView ? 'Choose a customer request.' : 'Your conversation starts here.'}
                  </h2>
                  <p className={styles.muted}>
                    {operatorView
                      ? 'Select a request to read the context and respond.'
                      : accepting
                        ? 'Create a new request or select an existing conversation.'
                        : 'Private support is currently unavailable for new messages. Existing conversations are still yours to review.'}
                  </p>
                </>
              )}
            </div>
          </div>
          <p className={styles.privacy}>
            Support messages are private and encrypted in storage. Draft text is kept only in this
            open page. Support records are separate from workspace data: deleting workspace
            preferences or plans does not remove these conversations. Delete your requests here, or
            read the <Link href="/privacy">privacy policy</Link>.
          </p>
          {viewerKey ? (
            <details className={styles.setup}>
              <summary>Operator setup</summary>
              <p>
                This is your signed-in account’s setup reference. It grants no access by itself.
                Only the app owner can enable operator access through the private server
                configuration. Keep this reference out of public issues.
              </p>
              <label className={styles.field}>
                Your operator setup viewer key
                <input
                  readOnly
                  value={viewerKey}
                  spellCheck={false}
                  autoComplete="off"
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <button
                className={styles.secondary}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(viewerKey);
                    setCopyNotice('Viewer key copied.');
                  } catch {
                    setCopyNotice('Select the field and copy the viewer key manually.');
                  }
                }}
              >
                Copy viewer key
              </button>
              {copyNotice ? <p role="status">{copyNotice}</p> : null}
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
