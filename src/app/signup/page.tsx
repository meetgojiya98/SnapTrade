import type { Metadata } from 'next';
import AuthEntry from '@/components/auth-entry';

export const metadata: Metadata = {
  title: 'Create your workspace — Balance',
  description:
    'Set up your SnapTrade Personal account, then create your connected Balance workspace.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/signup' },
};

export default function SignUpPage() {
  return <AuthEntry mode="signup" />;
}
