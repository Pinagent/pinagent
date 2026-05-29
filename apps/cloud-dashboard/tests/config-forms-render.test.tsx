// SPDX-License-Identifier: Elastic-2.0
import type { BranchRoutingPolicy, CostControl } from '@pinagent/ee-team-features';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BranchRoutingForm } from '../src/BranchRoutingForm';
import { CostControlForm } from '../src/CostControlForm';

const noop = async () => {};

describe('CostControlForm initial render', () => {
  it('pre-fills the current cap and enforcement', () => {
    const initial: CostControl = {
      organizationId: 'o',
      maxRelaySessionsPerPeriod: 5000,
      enforcement: 'warn',
    };
    const html = renderToStaticMarkup(
      <CostControlForm initial={initial} onSubmit={noop} onCancel={() => {}} />,
    );
    expect(html).toContain('value="5000"');
    // the warn option is the selected one
    expect(html).toMatch(/<option value="warn"[^>]*selected/);
    expect(html).toContain('Save');
  });

  it('leaves the cap blank when there is no cap', () => {
    const initial: CostControl = {
      organizationId: 'o',
      maxRelaySessionsPerPeriod: null,
      enforcement: 'block',
    };
    const html = renderToStaticMarkup(
      <CostControlForm initial={initial} onSubmit={noop} onCancel={() => {}} />,
    );
    expect(html).toContain('value=""');
    expect(html).toMatch(/<option value="block"[^>]*selected/);
  });
});

describe('BranchRoutingForm initial render', () => {
  it('pre-fills the base branch and one pattern per line', () => {
    const initial: BranchRoutingPolicy = {
      organizationId: 'o',
      defaultBaseBranch: 'main',
      allowedBranchPatterns: ['feat/*', 'fix/*'],
    };
    const html = renderToStaticMarkup(
      <BranchRoutingForm initial={initial} onSubmit={noop} onCancel={() => {}} />,
    );
    expect(html).toContain('value="main"');
    // textarea content carries the newline-joined patterns
    expect(html).toContain('feat/*\nfix/*');
  });

  it('renders empty fields for a null policy', () => {
    const html = renderToStaticMarkup(
      <BranchRoutingForm initial={null} onSubmit={noop} onCancel={() => {}} />,
    );
    expect(html).toContain('value=""');
  });
});
