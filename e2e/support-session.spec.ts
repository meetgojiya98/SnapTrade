import { expect, test, type Page } from '@playwright/test';
import { mockLiveWorkspace } from './fixtures';
import { mockSupport, supportThread } from './support-fixtures';

const anonymousHeading = 'Connect to open your private support.';
const signedOutNotice = 'Signed out. Your support conversations are kept for your next sign-in.';
const peerNotice = 'You were signed out in another tab. Sign in again to continue.';
const signOut = (page: Page) => page.getByRole('button', { name: 'Sign out', exact: true });

async function expectPrivateSupportCleared(page: Page, privateBody: string) {
  await expect(page.getByRole('heading', { name: anonymousHeading, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Support conversation', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByRole('region', { name: 'Support request list', exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText(privateBody, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Operator inbox', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('textbox', { name: 'Your operator setup viewer key', exact: true }),
  ).toHaveCount(0);
}

test('private support sign-out clears conversations and drafts, keeps saved requests and notifies workspace tabs', async ({
  page,
  context,
}) => {
  const privateBody = 'A synthetic private conversation that must disappear after sign-out.';
  const thread = supportThread('A saved private conversation');
  thread.messages[0].body = privateBody;
  const server = await mockSupport(page, { role: 'operator', threads: [thread] });
  const workspace = await context.newPage();
  await mockLiveWorkspace(workspace);
  await workspace.goto('/app');
  await expect(workspace.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  await page.goto('/support/inbox');
  await expect(page.getByRole('region', { name: 'Support conversation' })).toContainText(
    privateBody,
  );
  await page.getByRole('textbox', { name: 'Your reply', exact: true }).fill('An unsent reply.');
  await page.getByRole('button', { name: 'New request', exact: true }).click();
  await page.getByRole('textbox', { name: 'Request title', exact: true }).fill('An unsent request');
  await page.getByRole('textbox', { name: 'What happened?', exact: true }).fill('An unsent body.');

  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const authRequests: { path: string; method: string }[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/auth/')) authRequests.push({ path, method: request.method() });
  });
  await page.route('**/api/auth/signout', async (route) => {
    await waiting;
    await route.fulfill({ json: { signedOut: true } });
  });
  try {
    await signOut(page).click();
    await expect(page.getByRole('button', { name: 'Signing out…', exact: true })).toBeDisabled();
    release();
    await expectPrivateSupportCleared(page, privateBody);
    await expect(page.getByText(signedOutNotice, { exact: true })).toBeVisible();
    await expect(workspace.getByRole('region', { name: 'Portfolio value' })).toHaveCount(0);
    await expect(workspace.getByText(peerNotice, { exact: true })).toBeVisible();
    expect(authRequests).toEqual([{ path: '/api/auth/signout', method: 'POST' }]);
    expect(server.getThreads()).toHaveLength(1);
    expect(server.requests.every((request) => request.method === 'GET')).toBe(true);

    // The harness signs the same account back in to verify that drafts were actually discarded.
    await page.getByRole('button', { name: 'I signed in, try again', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Your reply', exact: true })).toHaveValue('');
    await page.getByRole('button', { name: 'New request', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Request title', exact: true })).toHaveValue('');
    await expect(page.getByRole('textbox', { name: 'What happened?', exact: true })).toHaveValue(
      '',
    );
  } finally {
    release();
  }
});

test('support sign-out requires confirmation and retains the conversation and draft for a retry', async ({
  page,
}) => {
  const thread = supportThread();
  await mockSupport(page, { threads: [thread] });
  let attempts = 0;
  await page.route('**/api/auth/signout', async (route) => {
    attempts += 1;
    await route.fulfill({ json: attempts === 1 ? { signedOut: false } : { signedOut: true } });
  });
  await page.goto('/support/inbox');
  const reply = page.getByRole('textbox', { name: 'Your reply', exact: true });
  const alerts = page
    .getByRole('region', { name: 'Private support', exact: true })
    .getByRole('alert');
  await reply.fill('Keep this unsent private draft until sign-out succeeds.');
  await signOut(page).click();
  await expect(alerts).toContainText('Sign-out could not be confirmed.');
  await expect(page.getByRole('region', { name: 'Support conversation' })).toContainText(
    thread.messages[0].body,
  );
  await expect(reply).toHaveValue('Keep this unsent private draft until sign-out succeeds.');
  await expect(signOut(page)).toBeEnabled();
  await signOut(page).click();
  await expectPrivateSupportCleared(page, thread.messages[0].body);
  await expect(alerts).toHaveCount(0);
  expect(attempts).toBe(2);
});

test('workspace sign-out clears a sibling private inbox and a late conversation cannot restore it', async ({
  page,
  context,
}) => {
  const thread = supportThread('A private conversation open in another tab');
  const server = await mockSupport(page, { threads: [thread] });
  await page.goto('/support/inbox');
  await expect(page.getByRole('region', { name: 'Support conversation' })).toContainText(
    thread.messages[0].body,
  );
  await page.getByRole('textbox', { name: 'Your reply', exact: true }).fill('A private draft.');
  const waiting = server.holdDetails();
  const previous = waiting.count();
  await page.getByRole('button', { name: 'Refresh requests', exact: true }).click();
  await expect.poll(waiting.count).toBeGreaterThan(previous);
  const workspace = await context.newPage();
  await mockLiveWorkspace(workspace);
  await workspace.route('**/api/auth/signout', (route) =>
    route.fulfill({ json: { signedOut: true } }),
  );
  await workspace.goto('/app');
  await expect(workspace.getByRole('region', { name: 'Portfolio value' })).toBeVisible();
  try {
    await workspace
      .getByRole('banner')
      .getByRole('button', { name: 'Sign out', exact: true })
      .click();
    await expectPrivateSupportCleared(page, thread.messages[0].body);
    await expect(page.getByText(peerNotice, { exact: true })).toBeVisible();
    const lateDetail = page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/support/${thread.id}`,
    );
    waiting.release();
    await (await lateDetail).finished();
    await expectPrivateSupportCleared(page, thread.messages[0].body);
    await expect(page.getByText(peerNotice, { exact: true })).toBeVisible();
  } finally {
    waiting.release();
  }
});
