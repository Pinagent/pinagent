// SPDX-License-Identifier: Apache-2.0
import { Button } from '@pinagent/ui/components/ui/button';
import { Card } from '@pinagent/ui/components/ui/card';
import { cn } from '@pinagent/ui/lib/utils';

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
    features: ['Up to 3 projects', 'Unlimited local feedback', 'Community support'],
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
    features: ['SSO & SAML', 'Audit logs', 'Dedicated support', 'Custom SLAs'],
    cta: 'Contact sales',
  },
];

export default function PricingPage() {
  return (
    <main className="mx-auto max-w-5xl p-10">
      <h1 className="text-4xl font-semibold tracking-tight">Pricing</h1>
      <p className="mt-2 leading-relaxed text-muted-foreground">
        Simple, transparent pricing. Pick the plan that fits your team.
      </p>

      <section
        className="mt-8 grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}
      >
        {tiers.map((tier) => (
          <Card
            key={tier.name}
            className={cn(
              'flex flex-col gap-4 p-6',
              tier.highlighted &&
                'border-primary bg-primary text-primary-foreground [&_*]:text-primary-foreground',
            )}
          >
            <div>
              <h2 className="m-0 text-xl font-semibold">{tier.name}</h2>
              <p
                className={cn(
                  'mt-2 mb-0 text-sm leading-relaxed',
                  tier.highlighted ? 'text-primary-foreground/70' : 'text-muted-foreground',
                )}
              >
                {tier.description}
              </p>
            </div>

            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">{tier.price}</span>
              {tier.cadence && (
                <span
                  className={cn(
                    'text-sm',
                    tier.highlighted ? 'text-primary-foreground/60' : 'text-muted-foreground',
                  )}
                >
                  {tier.cadence}
                </span>
              )}
            </div>

            <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
              {tier.features.map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span aria-hidden="true">•</span>
                  {feature}
                </li>
              ))}
            </ul>

            <Button
              type="button"
              variant={tier.highlighted ? 'secondary' : 'default'}
              size="lg"
              className="mt-auto"
            >
              {tier.cta}
            </Button>
          </Card>
        ))}
      </section>
    </main>
  );
}
