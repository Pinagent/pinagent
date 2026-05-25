import { CounterList } from './CounterList';
import { Footer } from './Footer';
import { Logo } from './_components/Logo';

export default function Page() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.75rem' }}>Pinagent · Next.js demo</h1>
      <p style={{ fontWeight: 'bold' }}>
        Click the{' '}
        <Logo
          size={16}
          style={{ verticalAlign: '-3px', borderRadius: 3 }}
        />{' '}
        button, pick an element, and leave a comment — an agent picks it up and edits the
        code directly.
      </p>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>
        Click. Comment. Ship. Try it below.
      </p>
      <section
        style={{
          marginTop: 24,
          maxHeight: 280,
          overflowY: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: 8,
          padding: 12,
          background: '#f9fafb',
        }}
      >
        <CounterList
          items={[
            { label: 'Blueberries', description: 'Tiny antioxidant-rich gems.' },
          ]}
        />
      </section>
      <Footer />
    </main>
  );
}
