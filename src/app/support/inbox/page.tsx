import type { Metadata } from 'next';
import PublicShell from '@/components/public-shell';
import SupportInbox from '@/components/support/inbox';

export const metadata: Metadata = {
  title: 'Private support — Balance',
  description: 'Your private Balance support requests and replies.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/support/inbox' },
};

export default function SupportInboxPage() {
  return (
    <PublicShell currentPage="support">
      <SupportInbox />
      <noscript>
        <p>Enable JavaScript to open your private support conversations.</p>
      </noscript>
    </PublicShell>
  );
}
