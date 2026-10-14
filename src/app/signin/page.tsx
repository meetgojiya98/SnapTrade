import type { Metadata } from 'next';
import AuthEntry from '@/components/auth-entry';

export const metadata: Metadata = {
  title: 'Sign in — Balance',
  description: 'Sign in to your Balance workspace with your SnapTrade Personal account.',
  robots: { index: false, follow: false },
  alternates: { canonical: '/signin' },
};

export default function SignInPage() {
  return <AuthEntry mode="signin" />;
}
