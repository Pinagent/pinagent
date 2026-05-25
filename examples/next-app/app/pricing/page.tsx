type Tier = {
  name: string;
  price: string;
  cadence: string;
  description: string;
  features: string[];
  cta: string;
  highlighted?: boolean;
};

const tiers: Tier[] = [
  {
    name: 'Hobby',
    price: '$0',
    cadence: '/month',
    description: 'For solo developers trying Pinagent on personal projects.',
    features: [
      'Up to 3 projects',
      'Unlimited local feedback',
      'Community support',
    ],
    cta: 'Get started',
  },
  {
    name: 'Pro',
    price: '$19',
    cadence: '/month',
    description: 'For small teams shipping production apps with Pinagent.',
    features: [
      'Unlimited projects',
      'Shared team workspaces',
      'Priority email support',
      'GitHub & Linear integrations',
    ],
    cta: 'Start free trial',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    cadence: '',
    description: 'For organizations with custom security and compliance needs.',
    features: [
      'SSO & SAML',
      'Audit logs',
      'Dedicated support',
      'Custom SLAs',
    ],
    cta: 'Contact sales',
  },
];

export default function PricingPage() {
  return (
    <main
      style={{
        fontFamily: 'system-ui, sans-serif',
        padding: '40px',
        maxWidth: 1080,
        margin: '0 auto',
      }}
    >
      <h1 style={{ fontSize: '2.25rem', marginBottom: 8 }}>Pricing</h1>
      <p style={{ color: '#4b5563', lineHeight: 1.55, marginTop: 0 }}>
        Simple, transparent pricing. Pick the plan that fits your team.
      </p>

      <section
        style={{
          marginTop: 32,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        {tiers.map((tier) => (
          <article
            key={tier.name}
            style={{
              border: tier.highlighted ? '1px solid #111827' : '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 24,
              background: tier.highlighted ? '#111827' : '#f9fafb',
              color: tier.highlighted ? '#f9fafb' : '#111827',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div>
              <h2 style={{ fontSize: '1.25rem', margin: 0 }}>{tier.name}</h2>
              <p
                style={{
                  color: tier.highlighted ? '#d1d5db' : '#4b5563',
                  lineHeight: 1.55,
                  marginTop: 8,
                  marginBottom: 0,
                  fontSize: '0.9rem',
                }}
              >
                {tier.description}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: '2rem', fontWeight: 700 }}>{tier.price}</span>
              {tier.cadence && (
                <span
                  style={{
                    color: tier.highlighted ? '#9ca3af' : '#6b7280',
                    fontSize: '0.9rem',
                  }}
                >
                  {tier.cadence}
                </span>
              )}
            </div>

            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {tier.features.map((feature) => (
                <li
                  key={feature}
                  style={{
                    fontSize: '0.9rem',
                    color: tier.highlighted ? '#e5e7eb' : '#374151',
                    display: 'flex',
                    gap: 8,
                  }}
                >
                  <span aria-hidden="true">•</span>
                  {feature}
                </li>
              ))}
            </ul>

            <button
              type="button"
              style={{
                marginTop: 'auto',
                padding: '10px 16px',
                borderRadius: 6,
                border: tier.highlighted ? '1px solid #f9fafb' : '1px solid #111827',
                background: tier.highlighted ? '#f9fafb' : '#111827',
                color: tier.highlighted ? '#111827' : '#f9fafb',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
              }}
            >
              {tier.cta}
            </button>
          </article>
        ))}
      </section>
    </main>
  );
}
