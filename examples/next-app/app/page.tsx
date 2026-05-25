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
      <h1>Pinpoint Next demo</h1>
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
        <Counter label="Apples" />
        <Counter label="Bananas" />
        <Counter label="Oranges" />
      </section>
      <Footer />
    </main>
  );
}
