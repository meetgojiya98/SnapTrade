import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import {
  supportLimits,
  type CreateSupportInput,
  type ReplySupportInput,
  type SupportRole,
  type SupportThread,
  type SupportThreadSummary,
} from '../src/lib/support';

export function supportThread(
  title = 'A synthetic customer question',
  canDelete = true,
): SupportThread {
  const createdAt = new Date().toISOString();
  return {
    id: randomUUID(),
    topic: 'planning',
    title,
    status: 'open',
    createdAt,
    updatedAt: createdAt,
    expiresAt: new Date(Date.now() + 180 * 86400_000).toISOString(),
    messageCount: 1,
    lastMessageRole: 'customer',
    requestReference: null,
    canDelete,
    messages: [
      {
        id: randomUUID(),
        author: 'customer',
        body: 'A synthetic private customer message.',
        createdAt,
      },
    ],
  };
}

const summarize = ({ messages: _messages, ...thread }: SupportThread): SupportThreadSummary =>
  thread;

/** UI harness only; real handler/store tests establish authorization and encryption. */
export async function mockSupport(
  page: Page,
  options: {
    role?: SupportRole;
    accepting?: boolean;
    threads?: SupportThread[];
    failCreateOnce?: boolean;
    failReplyOnce?: boolean;
  } = {},
) {
  let role = options.role ?? 'customer';
  let accepting = options.accepting ?? true;
  let threads = structuredClone(options.threads ?? []);
  let failCreate = options.failCreateOnce ?? false;
  let failReply = options.failReplyOnce ?? false;
  let allDenied = false;
  let failList = false;
  let viewerKey = 'a'.repeat(64);
  let visibleIds: Set<string> | null = null;
  let detailWait: Promise<void> | undefined;
  let replyWait: Promise<void> | undefined;
  let detailRequests = 0;
  const createInputs: CreateSupportInput[] = [];
  const replyInputs: ReplySupportInput[] = [];
  const requests: { method: string; path: string }[] = [];
  const createdIds = new Map<string, string>();
  const replyIds = new Set<string>();
  const update = (thread: SupportThread) => {
    thread.updatedAt = new Date(Date.now() + requests.length * 1000).toISOString();
    thread.expiresAt = new Date(Date.parse(thread.updatedAt) + 180 * 86400_000).toISOString();
    thread.messageCount = thread.messages.length;
    thread.lastMessageRole = thread.messages.at(-1)!.author;
  };
  await page.route(/\/api\/support(?:[/?]|$)/, async (route) => {
    const incoming = route.request();
    const url = new URL(incoming.url());
    const method = incoming.method();
    requests.push({ method, path: url.pathname });
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 2) {
      if (method === 'GET') {
        if (failList) {
          failList = false;
          await route.fulfill({
            status: 503,
            json: {
              code: 'service_unavailable',
              error: 'The support list could not be refreshed.',
            },
          });
          return;
        }
        if (url.searchParams.get('scope') === 'all' && (allDenied || role !== 'operator')) {
          await route.fulfill({
            status: 403,
            json: { code: 'support_forbidden', error: 'Operator access is no longer available.' },
          });
          return;
        }
        await route.fulfill({
          json: {
            role,
            viewerKey,
            acceptingRequests: accepting,
            limits: supportLimits,
            threads: threads
              .filter(
                (thread) =>
                  url.searchParams.get('scope') === 'all' ||
                  (thread.canDelete && (!visibleIds || visibleIds.has(thread.id))),
              )
              .map(summarize),
            nextCursor: null,
          },
        });
        return;
      }
      if (method === 'DELETE') {
        threads = threads.filter((thread) => !thread.canDelete);
        await route.fulfill({ json: { deleted: true } });
        return;
      }
      const input = incoming.postDataJSON() as CreateSupportInput;
      createInputs.push(input);
      let thread = threads.find((item) => item.id === createdIds.get(input.clientRequestId));
      if (!thread) {
        thread = supportThread(input.title);
        thread.topic = input.topic;
        thread.requestReference = input.requestReference;
        thread.messages[0].body = input.message;
        threads.unshift(thread);
        createdIds.set(input.clientRequestId, thread.id);
      }
      if (failCreate) {
        failCreate = false;
        await route.fulfill({
          status: 503,
          json: {
            error: 'Support could not confirm this send. Your draft is still here.',
            code: 'service_unavailable',
            requestId: '00000000-0000-4000-8000-000000000001',
          },
        });
      } else await route.fulfill({ status: 201, json: { thread } });
      return;
    }
    const thread = threads.find((item) => item.id === segments[2]);
    if (!thread) {
      await route.fulfill({
        status: 404,
        json: { error: 'Support request not found.', code: 'support_not_found' },
      });
      return;
    }
    if (method === 'GET') {
      detailRequests += 1;
      if (detailWait) await detailWait;
      await route.fulfill({ json: { thread } });
    } else if (segments[3] === 'messages') {
      const input = incoming.postDataJSON() as ReplySupportInput;
      replyInputs.push(input);
      if (replyWait) await replyWait;
      if (!replyIds.has(input.clientRequestId)) {
        replyIds.add(input.clientRequestId);
        thread.messages.push({
          id: randomUUID(),
          author: role,
          body: input.message,
          createdAt: new Date().toISOString(),
        });
        update(thread);
      }
      if (failReply) {
        failReply = false;
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '60' },
          json: {
            code: 'support_rate_limited',
            error: 'Wait before sending again.',
          },
        });
      } else await route.fulfill({ json: { thread } });
    } else if (method === 'PATCH') {
      thread.status = incoming.postDataJSON().status;
      update(thread);
      await route.fulfill({ json: { thread } });
    } else if (method === 'DELETE') {
      threads = threads.filter((item) => item.id !== thread.id);
      await route.fulfill({ json: { deleted: true } });
    }
  });
  return {
    createInputs,
    replyInputs,
    requests,
    getThreads: () => threads,
    appendOperatorReply(id: string, body: string) {
      const thread = threads.find((item) => item.id === id)!;
      thread.messages.push({
        id: randomUUID(),
        author: 'operator',
        body,
        createdAt: new Date().toISOString(),
      });
      update(thread);
    },
    denyOperatorScope() {
      role = 'customer';
      allDenied = true;
      accepting = false;
    },
    holdDetails() {
      let release!: () => void;
      detailWait = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { release, count: () => detailRequests };
    },
    failNextList() {
      failList = true;
    },
    switchViewer(next: SupportThread[]) {
      threads.push(...structuredClone(next));
      visibleIds = new Set(next.map((thread) => thread.id));
      viewerKey = 'b'.repeat(64);
      role = 'customer';
      accepting = true;
    },
    holdReplies() {
      let release!: () => void;
      replyWait = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { release };
    },
  };
}
