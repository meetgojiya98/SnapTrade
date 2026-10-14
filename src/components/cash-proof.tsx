import { ShieldCheck } from 'lucide-react';
import type { Account, Plan } from '@/lib/types';

export default function CashProof({
  accounts,
  plan,
  contributionCents,
  contributionAccountId,
  currency,
}: {
  accounts: Account[];
  plan: Plan;
  contributionCents: number;
  contributionAccountId: string | null;
  currency: string;
}) {
  if (plan.status !== 'ready') return null;
  const format = (cents: number) =>
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(cents / 100);
  return (
    <section className="card cash-proof">
      <div className="section-heading">
        <div>
          <span className="step-label">CHECK THE CASH, ACCOUNT BY ACCOUNT</span>
          <h2>Every move has its own funding.</h2>
          <p>No cash crosses between accounts. Sale proceeds must settle before buying.</p>
        </div>
        <ShieldCheck size={21} className="muted-icon" />
      </div>
      <div className="table-scroll">
        <table aria-label="Account funding ledger">
          <thead>
            <tr>
              <th scope="col">ACCOUNT</th>
              <th scope="col" className="numeric">
                CASH + NEW
              </th>
              <th scope="col" className="numeric">
                SELLS
              </th>
              <th scope="col" className="numeric">
                BUYS
              </th>
              <th scope="col" className="numeric">
                CASH AFTER
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const cash =
                account.cashCents + (account.id === contributionAccountId ? contributionCents : 0);
              const sells = plan.trades
                .filter((t) => t.accountId === account.id && t.side === 'sell')
                .reduce((s, t) => s + t.valueCents, 0);
              const buys = plan.trades
                .filter((t) => t.accountId === account.id && t.side === 'buy')
                .reduce((s, t) => s + t.valueCents, 0);
              return (
                <tr key={account.id}>
                  <td>
                    <strong>{account.broker}</strong>
                    <small>{account.name}</small>
                  </td>
                  <td className="numeric">{format(cash)}</td>
                  <td className="numeric">+{format(sells)}</td>
                  <td className="numeric">−{format(buys)}</td>
                  <td className="numeric value-cell">{format(cash + sells - buys)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="inline-note">
        Cash after = reported cash + hypothetical contribution + estimated sells − estimated buys.
        Includes your protected reserve.
      </p>
    </section>
  );
}
