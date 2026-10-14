import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mockSupport, supportThread } from './support-fixtures';

async function accessible(page: Page, surface: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect
    .soft(
      result.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
      })),
      surface,
    )
    .toEqual([]);
}

async function capture(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath(name), fullPage: true });
}

test('private support keeps conversations hidden while authentication is loading or expired', async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/support(?:[/?]|$)/, async (route) => {
    await waiting;
    await route.fulfill({ status: 401, json: null });
  });
  await page.goto('/support');
  await page.getByRole('link', { name: 'Open private support', exact: true }).first().click();
  await expect(page).toHaveURL(/\/support\/inbox$/);
  await expect(page.getByText('Loading private support…', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Support conversation', exact: true })).toHaveCount(
    0,
  );
  release();
  await expect(
    page.getByRole('heading', { name: 'Connect to open your private support.', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Operator inbox', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send private request', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole('link', { name: 'Open workspace to sign in', exact: true }),
  ).toHaveAttribute('href', '/app');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

test('customers retain private drafts on failed sends and can return, reply, resolve and delete without duplicate messages', async ({
  page,
}) => {
  const server = await mockSupport(page, { failCreateOnce: true, failReplyOnce: true });
  await page.goto('/support/inbox');
  const title = page.getByRole('textbox', { name: 'Request title', exact: true });
  const message = page.getByRole('textbox', { name: 'What happened?', exact: true });
  const reference = page.getByRole('textbox', {
    name: 'Error request reference (optional)',
    exact: true,
  });
  const submit = page.getByRole('button', { name: 'Send private request', exact: true });
  await expect(title).toBeVisible();
  await page.getByText('Operator setup', { exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Your operator setup viewer key', exact: true }),
  ).toHaveValue('a'.repeat(64));
  await accessible(page, 'Desktop request form and operator setup');
  await capture(page, 'form-desktop.png');
  const desktop = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await accessible(page, 'Mobile request form and operator setup');
  await capture(page, 'form-mobile.png');
  await page.setViewportSize(desktop);
  await title.fill('A private synthetic planning question');
  const privateBody = '<img src=x onerror="window.supportInjected=true"> Synthetic private report.';
  await message.fill(privateBody);
  await expect(title).toHaveAttribute('maxlength', '100');
  await expect(message).toHaveAttribute('maxlength', '4000');
  await reference.fill('account 12345');
  await expect(submit).toBeDisabled();
  await reference.fill('00000000-0000-4000-8000-000000000002');
  const cancelled = page.waitForEvent('dialog').then(async (dialog) => {
    expect(dialog.type()).toBe('confirm');
    await dialog.dismiss();
  });
  await Promise.all([
    cancelled,
    page.getByRole('link', { name: 'Help & support', exact: true }).click(),
  ]);
  await expect(message).toHaveValue(privateBody);
  await expect(page).toHaveURL(/\/support\/inbox$/);
  await submit.click();
  await expect(
    page.getByRole('region', { name: 'Private support', exact: true }).getByRole('alert'),
  ).toContainText('00000000-0000-4000-8000-000000000001');
  await expect(message).toHaveValue(privateBody);
  await expect(title).toHaveValue('A private synthetic planning question');
  await submit.click();
  const conversation = page.getByRole('region', { name: 'Support conversation', exact: true });
  await expect(conversation).toContainText(privateBody);
  await expect(conversation.locator('img')).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as Window & { supportInjected?: boolean }).supportInjected),
  ).toBeUndefined();
  expect(server.createInputs).toHaveLength(2);
  expect(server.createInputs[0].clientRequestId).toBe(server.createInputs[1].clientRequestId);
  expect(Object.keys(server.createInputs[0]).sort()).toEqual([
    'clientRequestId',
    'message',
    'requestReference',
    'title',
    'topic',
  ]);
  expect(server.getThreads()).toHaveLength(1);
  const reply = page.getByRole('textbox', { name: 'Your reply', exact: true });
  await reply.fill('A synthetic follow-up that must survive a retry.');
  const id = server.getThreads()[0].id;
  server.appendOperatorReply(id, 'A synthetic operator answer.');
  await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
  await expect(conversation).toContainText('A synthetic operator answer.');
  await expect(reply).toHaveValue('A synthetic follow-up that must survive a retry.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Private support', exact: true }).getByRole('alert'),
  ).toContainText('Wait about 1 minute(s)');
  await expect(reply).toHaveValue('A synthetic follow-up that must survive a retry.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(reply).toHaveValue('');
  expect(server.replyInputs).toHaveLength(2);
  expect(server.replyInputs[0].clientRequestId).toBe(server.replyInputs[1].clientRequestId);
  expect(server.getThreads()[0].messages).toHaveLength(3);
  const storage = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  );
  expect(storage).not.toContain(privateBody);
  expect(storage).not.toContain('synthetic follow-up');
  await page.reload();
  await expect(conversation).toContainText(privateBody);
  await expect(conversation).toContainText('A synthetic operator answer.');
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click();
  await expect(
    page.getByText('This request is resolved. Reopen it to continue the conversation.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reopen request', exact: true }).click();
  await expect(reply).toBeVisible();
  await accessible(page, 'Desktop customer support conversation');
  await capture(page, 'conversation-desktop.png');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await accessible(page, 'Mobile support conversation');
  await capture(page, 'conversation-mobile.png');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete request', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Support conversation', exact: true })).toHaveCount(
    0,
  );
  expect(server.getThreads()).toHaveLength(0);
  await title.fill('Another synthetic request');
  await message.fill('A disposable synthetic conversation.');
  await submit.click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete all my support requests', exact: true }).click();
  await expect(
    page.getByText('All of your support requests and messages were deleted.', { exact: true }),
  ).toBeVisible();
  expect(server.getThreads()).toHaveLength(0);
  await page.goto('/support');
  await expect(page.getByText(privateBody, { exact: true })).toHaveCount(0);
  const issue = page.getByRole('link', { name: 'Review issue draft on GitHub', exact: true });
  await expect(issue).toHaveAttribute('href', /github\.com/);
  expect((await issue.getAttribute('href'))!).not.toContain(encodeURIComponent(privateBody));
});

test('an unmonitored inbox accepts no new messages while existing requests remain readable and removable', async ({
  page,
}) => {
  const thread = supportThread('An older private request');
  thread.messages = Array.from({ length: 50 }, (_, index) => ({
    id: randomUUID(),
    author: 'customer' as const,
    body: `Synthetic message ${index + 1}.`,
    createdAt: thread.createdAt,
  }));
  thread.messageCount = 50;
  const server = await mockSupport(page, { accepting: false, threads: [thread] });
  await page.goto('/support/inbox');
  await expect(
    page.getByRole('region', { name: 'Support conversation', exact: true }),
  ).toContainText('Synthetic message 50.');
  await expect(page.getByRole('button', { name: 'New request', exact: true })).toBeDisabled();
  await expect(
    page.getByText('Private support is not accepting new messages right now.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'This conversation has reached its 50-message limit. Create a new request if you need more help.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Operator inbox', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark resolved', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen request', exact: true })).toBeDisabled();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete request', exact: true }).click();
  await expect(
    page.getByText('No support requests yet. Your conversations will appear here.', {
      exact: true,
    }),
  ).toBeVisible();
  expect(server.requests.filter((request) => request.method === 'POST')).toEqual([]);
});

test('operators can reply to customers but losing their role clears foreign conversations and rejects late detail responses', async ({
  page,
}) => {
  const thread = supportThread('A foreign customer request', false);
  const server = await mockSupport(page, { role: 'operator', threads: [thread] });
  await page.goto('/support/inbox');
  await page.getByRole('button', { name: 'Operator inbox', exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Operator inbox.', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Support conversation', exact: true }),
  ).toContainText('A synthetic private customer message.');
  await expect(page.getByRole('button', { name: 'Delete request', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Delete all my support requests', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('textbox', { name: 'Reply to the customer', exact: true })
    .fill('A synthetic operator response.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Support conversation', exact: true }),
  ).toContainText('A synthetic operator response.');
  expect(server.getThreads()[0].messages.at(-1)?.author).toBe('operator');
  await accessible(page, 'Desktop operator conversation');
  await capture(page, 'operator-desktop.png');
  const pending = server.holdDetails();
  const previous = pending.count();
  server.denyOperatorScope();
  await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
  await expect.poll(pending.count).toBeGreaterThan(previous);
  await expect(
    page.getByRole('region', { name: 'Private support', exact: true }).getByRole('alert'),
  ).toContainText('Operator access is no longer available.');
  pending.release();
  await expect(page.getByRole('button', { name: 'Operator inbox', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Support conversation', exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('A synthetic private customer message.', { exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry request list', exact: true }).click();
  await expect(
    page.getByText('No support requests yet. Your conversations will appear here.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh requests', exact: true })).toBeEnabled();
});

test('pending sends disable error retries and a changed signed-in identity clears old drafts and late conversation responses', async ({
  page,
}) => {
  const original = supportThread('The first customer conversation');
  original.messages[0].body = 'Synthetic first-customer private content.';
  const next = supportThread('The second customer conversation');
  next.messages[0].body = 'Synthetic second-customer private content.';
  const server = await mockSupport(page, { threads: [original] });
  await page.goto('/support/inbox');
  const reply = page.getByRole('textbox', { name: 'Your reply', exact: true });
  await reply.fill('A synthetic pending reply.');
  server.failNextList();
  await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
  const retry = page.getByRole('button', { name: 'Retry request list', exact: true });
  await expect(retry).toBeEnabled();
  await expect(reply).toHaveValue('A synthetic pending reply.');
  const sending = server.holdReplies();
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await expect.poll(() => server.replyInputs.length).toBe(1);
  await expect(retry).toBeDisabled();
  sending.release();
  await expect(reply).toHaveValue('');
  await expect(retry).toBeEnabled();
  await reply.fill('An unsent draft belonging only to the first customer.');
  const oldDetails = server.holdDetails();
  const previous = oldDetails.count();
  server.switchViewer([next]);
  await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
  await expect.poll(oldDetails.count).toBeGreaterThanOrEqual(previous + 2);
  oldDetails.release();
  const conversation = page.getByRole('region', { name: 'Support conversation', exact: true });
  await expect(conversation).toContainText('Synthetic second-customer private content.');
  await expect(
    page.getByText('Synthetic first-customer private content.', { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText('The first customer conversation', { exact: true })).toHaveCount(0);
  await expect(reply).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Refresh requests', exact: true })).toBeEnabled();
});
