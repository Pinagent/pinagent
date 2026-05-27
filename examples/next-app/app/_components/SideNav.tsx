// SPDX-License-Identifier: Apache-2.0
'use client';

import { cn } from '@pinagent/ui/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
];

export function SideNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive =
          item.href === '/'
            ? pathname === '/'
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'rounded-md px-2.5 py-2 text-[13px] no-underline transition-colors',
              isActive
                ? 'bg-secondary font-medium text-foreground'
                : 'text-foreground/70 hover:bg-secondary/60 hover:text-foreground',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
