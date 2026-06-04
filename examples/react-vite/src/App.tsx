import { Logo } from '@pinagent/widget/logo';
import { useState } from 'react';
import { Counter } from './Counter';

export function App() {
  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        display: 'grid',
        gridTemplateColumns: '220px 1fr',
        minHeight: '100vh',
      }}
    >
      <Sidebar />
      <main style={{ padding: '40px', maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ fontSize: 64, fontWeight: 900 }}>Pinagent demo</h1>
        <p>
          Open the <Logo size={16} style={{ verticalAlign: '-3px', borderRadius: 3 }} /> button in
          the bottom-right, pick an element, and leave a comment.
        </p>
        <p style={{ color: '#9ca3af', fontSize: 14, lineHeight: 1.55 }}>
          Leave feedback right on the UI. Every comment records a screenshot, the selected element,
          and the exact source file and line that produced it — sending your request straight to the
          code that needs changing. Try it on anything here, including the counters and the footer.
        </p>
        <section style={{ marginTop: 24 }}>
          <Counter label="Pineapple" accent="#f97316" />
          <Counter label="Grapes" />
          <Counter label="Oranges" />
          <Counter label="Mangoes" />
          <Counter label="Blueberries" />
        </section>
        <Footer />
      </main>
    </div>
  );
}

function Sidebar() {
  const items = ['Overview', 'Counters', 'Activity', 'Settings'];
  return (
    <aside
      style={{
        borderRight: '1px solid #1f2937',
        padding: '40px 20px',
        background: '#111827',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <Logo size={18} style={{ borderRadius: 4 }} />
        <span style={{ fontWeight: 600, fontSize: 14, color: '#f9fafb' }}>Pinagent</span>
      </div>
      <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, i) => (
          <a
            key={item}
            href={`#${item.toLowerCase()}`}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              textDecoration: 'none',
              fontSize: 14,
              color: i === 0 ? '#f9fafb' : '#9ca3af',
              background: i === 0 ? '#374151' : 'transparent',
            }}
          >
            {item}
          </a>
        ))}
      </nav>
    </aside>
  );
}

function Footer() {
  const [hovered, setHovered] = useState(false);
  return (
    <footer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ marginTop: 40, color: hovered ? '#111827' : '#6b7280', fontSize: 13 }}
    >
      Built as a Pinagent smoke-test playground — a minimal Vite + React app for exercising the
      click-to-comment flow end to end, from widget selection through agent fixes in the editor.
    </footer>
  );
}
