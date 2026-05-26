import { Logo } from '@pinagent/widget/logo';
import { useState } from 'react';
import { Counter } from './Counter';

export function App() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1>Pinagent demo</h1>
      <p>
        Open the <Logo size={16} style={{ verticalAlign: '-3px', borderRadius: 3 }} /> button in the
        bottom-right, pick an element, and leave a comment.
      </p>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>
        Leave feedback right on the UI. Every comment records a screenshot, the selected element,
        and the exact source file and line that produced it — sending your request straight to the
        code that needs changing. Try it on anything here, including the counters and the footer.
      </p>
      <section style={{ marginTop: 24 }}>
        <Counter label="Apples" />
        <Counter label="Bananas" />
        <Counter label="Oranges" />
      </section>
      <Footer />
    </main>
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
      Built for pinagent smoke tests.
    </footer>
  );
}
