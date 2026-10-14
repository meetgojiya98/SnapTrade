'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Menu, X } from 'lucide-react';
import styles from '@/app/landing.module.css';

const links = [
  { href: '#product', label: 'The product' },
  { href: '#how-it-works', label: 'How it works' },
  { href: '/guide', label: 'Guide' },
  { href: '/support', label: 'Support' },
];

export default function LandingHeader() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return (
    <header className={styles.header}>
      <Link className={styles.logo} href="/" aria-label="Balance home">
        <span aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        balance.
      </Link>
      <nav className={styles.desktopNav} aria-label="Main navigation">
        {links.map((link) => (
          <Link key={link.href} href={link.href}>
            {link.label}
          </Link>
        ))}
      </nav>
      <div className={styles.headerActions}>
        <Link className={styles.headerSignIn} href="/signin">
          Sign in
        </Link>
        <Link className={styles.headerCta} href="/signup">
          Get started <ArrowUpRight size={16} />
        </Link>
        <button
          className={styles.menuButton}
          ref={toggle}
          type="button"
          aria-expanded={open}
          aria-controls="landing-mobile-navigation"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={23} /> : <Menu size={23} />}
        </button>
      </div>
      {open && (
        <nav
          className={styles.mobileNav}
          id="landing-mobile-navigation"
          aria-label="Mobile navigation"
        >
          {links.map((link) => (
            <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {link.label}
              <ArrowUpRight size={16} />
            </Link>
          ))}
          <Link href="/demo" onClick={() => setOpen(false)}>
            Try the interactive demo
            <ArrowUpRight size={16} />
          </Link>
        </nav>
      )}
    </header>
  );
}
