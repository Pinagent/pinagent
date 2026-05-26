import { useState } from 'react';
import { Counter } from './Counter';

const PIN_PATH =
  'M38.0761 27C24.2046 27 16.7486 43.8193 26.2852 53.7027L26.4587 53.8761L47.2659 74.6834L68.0732 53.8761L68.2466 53.7027C77.9567 43.8193 70.3273 27 56.4558 27L38.0761 27Z';

function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 93 93"
      style={{ verticalAlign: '-3px', borderRadius: 3 }}
      aria-hidden="true"
    >
      <rect width="93" height="93" fill="#FCF9E8" />
      <path d={PIN_PATH} fill="#201B21" />
    </svg>
  );
}

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
        Open the <Logo size={16} /> button in the bottom-right, pick an element, and leave a
        comment.
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
