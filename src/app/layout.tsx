import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Balance — Your portfolio, in perspective',
  description:
    'Understand your investments across brokerages. Build an explainable, cash-aware rebalancing plan with SnapTrade.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
