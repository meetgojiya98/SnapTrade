import type { Metadata } from 'next';
import Dashboard from '@/components/dashboard';
export const metadata: Metadata = {
  title: 'Sample workspace — Balance',
  robots: { index: false, follow: false },
};
export default function DemoPage() {
  return <Dashboard mode="demo" />;
}
