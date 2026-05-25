'use client';
import { useState } from 'react';

export function Footer() {
  const [hovered, setHovered] = useState(false);
  return (
    <footer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ marginTop: 40, color: hovered ? '#111827' : '#6b7280', fontSize: 13 }}
    >
      Built for pinpoint smoke tests.
    </footer>
  );
}
