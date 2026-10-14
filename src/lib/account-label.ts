import type { Account } from './types';

/** Account numbers are masked at the portfolio normalization boundary. */
export function accountDisplayName(account: Account): string {
  return `${account.broker} · ${account.name} · ${account.number}`;
}
