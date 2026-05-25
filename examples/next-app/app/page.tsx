import { Counter } from './Counter';
import { Footer } from './Footer';

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
      <h1 style={{ fontSize: '2.75rem' }}>Pinpoint · Next.js demo</h1>
      <p style={{ fontWeight: 'bold' }}>
        Click the 💬 button, pick an element, and leave a comment — an agent picks it up
        and edits the code directly.
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
        <Counter label="Bananas" description="Soft, potassium-rich, perfect for smoothies." />
        <Counter label="Oranges" description="Juicy citrus packed with vitamin C." />
        <Counter label="Grapes" description="Bite-sized bursts of sweetness." />
        <Counter label="Apples" description="Crisp and sweet, an everyday classic." />
        <Counter label="Strawberries" description="Bright, fragrant, and bursting with flavor." />
        <Counter label="Blueberries" description="Tiny antioxidant powerhouses." />
        <Counter label="Mangoes" description="Tropical, sweet, and golden." />
        <Counter label="Pineapples" description="Tangy and refreshing with a tropical bite." />
        <Counter label="Watermelons" description="Hydrating summer staple, juicy and cool." />
        <Counter label="Peaches" description="Fuzzy, fragrant, and irresistibly juicy." />
      </section>
      <Footer />
    </main>
  );
}
