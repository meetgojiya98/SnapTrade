import type { Metadata } from 'next';
import './globals.css';
import './workspace-theme.css';
import './workspace-panels.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://balance-snaptrade.vercel.app'),
  title: 'Balance — Your portfolio, in perspective',
  description:
    'One portfolio. Every account considered. Explore an explainable rebalancing plan that respects each account’s cash, your targets, and your choices.',
  openGraph: {
    type: 'website',
    siteName: 'Balance',
    title: 'Balance — Your portfolio, in perspective.',
    description:
      'Bring your accounts into perspective. Build a considered rebalancing plan, with every decision yours.',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Balance — Your portfolio, in perspective.',
    description: 'Account-aware portfolio planning. Your targets. Your choices.',
  },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
