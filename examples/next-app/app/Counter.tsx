'use client';
import { useState } from 'react';

export function Counter({ label, description }: { label: string; description?: string }) {
  const [count, setCount] = useState(0);
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        border: `1px solid ${hovered ? '#94a3b8' : '#e5e7eb'}`,
        background: hovered ? '#f1f5f9' : 'transparent',
        borderRadius: 8,
        marginBottom: 8,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        {description && <span style={{ color: '#6b7280', fontSize: 13 }}>{description}</span>}
      </div>
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        style={{
          background: '#4ade80',
          color: '#020617',
          border: 0,
          padding: '6px 12px',
          borderRadius: 6,
          cursor: 'pointer',
        }}
      >
        {count}
      </button>
    </div>
  );
}
