import 'server-only';
import type { Portfolio } from '@/lib/types';
import { ServiceError, safeError } from './errors';
import { normalizeAccount, record } from './normalize';
import { getOAuthService, type OAuthService } from './oauth';

function accountError(label: string, error: unknown): string {
  const safe = safeError(error);
  if (safe.code === 'rate_limited')
    return `${label} could not be loaded because SnapTrade rate limited the request.${safe.retryAfter ? ` Retry after ${safe.retryAfter}.` : ' Wait before refreshing.'}`;
  return `${label} could not be loaded. Refresh before creating a plan.`;
}

export async function loadPortfolio(
  sessionId: string,
  service: Pick<OAuthService, 'api'> = getOAuthService(),
): Promise<Portfolio> {
  const [accountsResult, connectionsResult] = await Promise.allSettled([
    service.api<unknown>(sessionId, '/accounts/all'),
    service.api<unknown>(sessionId, '/authorizations'),
  ]);
  if (accountsResult.status === 'rejected') throw accountsResult.reason;
  if (
    connectionsResult.status === 'rejected' &&
    safeError(connectionsResult.reason).code === 'reconnect_required'
  )
    throw connectionsResult.reason;
  const response = record(accountsResult.value);
  if (!Array.isArray(response.results)) throw new ServiceError('invalid_accounts_response');
  if (response.results.length > 100)
    throw new ServiceError(
      'too_many_accounts',
      422,
      'This workspace has more than 100 accounts. Use a smaller workspace for this planner.',
    );
  const warnings: string[] = [];
  const all = response.results.map(record);
  const rawAccounts = all.filter((account) => account.kind === 'investment');
  if (all.length !== rawAccounts.length)
    warnings.push('Bank deposit, credit, and other non-investment accounts are excluded.');
  const connections =
    connectionsResult.status === 'fulfilled' && Array.isArray(connectionsResult.value)
      ? new Map(
          connectionsResult.value.map((item) => {
            const value = record(item);
            return [value.id, value] as const;
          }),
        )
      : new Map();
  if (
    connectionsResult.status === 'rejected' ||
    (connectionsResult.status === 'fulfilled' && !Array.isArray(connectionsResult.value))
  ) {
    warnings.push(
      'Brokerage connection status is unavailable. Planning is blocked until it can be verified.',
    );
  }
  const accounts: Portfolio['accounts'] = [];
  // Bound fan-out; large portfolios do not produce an unbounded burst of brokerage calls.
  for (let start = 0; start < rawAccounts.length; start += 3) {
    const batch = await Promise.all(
      rawAccounts.slice(start, start + 3).map(async (account) => {
        if (typeof account.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(account.id))
          throw new ServiceError('invalid_account_id');
        const [positions, balances] = await Promise.allSettled([
          service.api<unknown>(
            sessionId,
            `/accounts/${encodeURIComponent(account.id)}/positions/all`,
          ),
          service.api<unknown>(sessionId, `/accounts/${encodeURIComponent(account.id)}/balances`),
        ]);
        for (const result of [positions, balances]) {
          if (
            result.status === 'rejected' &&
            safeError(result.reason).code === 'reconnect_required'
          )
            throw result.reason;
        }
        const connection = connections.get(account.connection_id);
        const brokerage = record(connection?.brokerage);
        const broker =
          typeof brokerage.display_name === 'string'
            ? brokerage.display_name
            : typeof brokerage.name === 'string'
              ? brokerage.name
              : undefined;
        return normalizeAccount(
          account,
          positions.status === 'fulfilled' ? positions.value : null,
          balances.status === 'fulfilled' ? balances.value : null,
          {
            broker,
            connectionKnown: Boolean(connection),
            connectionDisabled: connection?.disabled === true,
            errors: [
              ...(positions.status === 'rejected'
                ? [accountError('Positions', positions.reason)]
                : []),
              ...(balances.status === 'rejected'
                ? [accountError('Cash balance', balances.reason)]
                : []),
            ],
          },
        );
      }),
    );
    accounts.push(...batch);
  }
  if (!accounts.length)
    warnings.push(
      'No investment accounts are connected. Add a brokerage in your SnapTrade Personal dashboard, then refresh.',
    );
  if (accounts.some((account) => account.issues.length > 0))
    warnings.push(
      'Some accounts have incomplete or unsupported data. Review account issues before creating a plan.',
    );
  return { mode: 'live', asOf: new Date().toISOString(), accounts, warnings };
}
