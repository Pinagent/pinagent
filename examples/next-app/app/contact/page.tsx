export default function ContactPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 720,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.25rem' }}>Contact</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.55 }}>Get in touch with the Pinagent team.</p>

      <section style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <article
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#f9fafb',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Email</h2>
          <p style={{ color: '#374151', lineHeight: 1.55, marginTop: 8, marginBottom: 0 }}>
            <a href="mailto:hello@pinagent.dev" style={{ color: '#2563eb' }}>
              hello@pinagent.dev
            </a>
          </p>
        </article>

        <article
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#f9fafb',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>GitHub</h2>
          <p style={{ color: '#374151', lineHeight: 1.55, marginTop: 8, marginBottom: 0 }}>
            File issues or open pull requests on the Pinagent repository.
          </p>
        </article>

        <article
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 20,
            background: '#f9fafb',
          }}
        >
          <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Community</h2>
          <p style={{ color: '#374151', lineHeight: 1.55, marginTop: 8, marginBottom: 0 }}>
            Join the conversation in our community channels for support, ideas, and discussion.
          </p>
        </article>
      </section>
    </main>
  );
}
