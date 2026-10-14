import type { Metadata } from 'next';
import Dashboard from '@/components/dashboard';
export const metadata: Metadata = {
  title: 'Your workspace — Balance',
  robots: { index: false, follow: false },
};
export default function WorkspacePage() {
  return <Dashboard mode="live" />;
}
