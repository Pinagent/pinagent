'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/issues', label: 'Issues' },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item) => {
        const isActive =
          item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              color: isActive ? '#111827' : '#4b5563',
              textDecoration: 'none',
              background: isActive ? '#f3f4f6' : 'transparent',
              fontWeight: isActive ? 500 : 400,
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
