'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/examples', label: 'Examples' },
  { href: '/changelog', label: 'Changelog' },
  { href: '/roadmap', label: 'Roadmap' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/issues', label: 'Issues' },
  { href: '/contact', label: 'Contact' },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((item) => {
        const isActive =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              padding: '8px 10px',
              borderRadius: 6,
              color: isActive ? '#201B21' : '#3D3730',
              textDecoration: 'none',
              background: isActive ? '#F5EFD0' : 'transparent',
              fontWeight: isActive ? 500 : 400,
              fontSize: 13,
            }}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
