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
      <h1 style={{ fontSize: '2.75rem' }}>Pinpoint Next demo</h1>
      <p>
        Open the 💬 button in the bottom-right, pick an element, and leave a comment.
      </p>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>
        Leave feedback right on the UI. Every comment records a screenshot, the selected
        element, and the exact source file and line that produced it — sending your request
        straight to the code that needs changing. Try it on anything here, including the
        counters and the footer.
      </p>
      <section style={{ marginTop: 24 }}>
        <Counter label="Apples" description="Crisp and sweet — great for snacking." />
        <Counter label="Bananas" description="Soft, potassium-rich, perfect for smoothies." />
        <Counter label="Oranges" description="Juicy citrus packed with vitamin C." />
        <Counter label="Grapes" description="Bite-sized bursts of sweetness." />
      </section>
      <Footer />
    </main>
  );
}
