import { useState } from 'react';

export function Counter({ label }: { label: string }) {
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
      <span style={{ fontWeight: 700 }}>{label}</span>
      <button
        type="button"
        onClick={() => setCount((c) => c + 1)}
        style={{
          background: '#e2e8f0',
          color: '#0f172a',
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
