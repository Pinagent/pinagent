// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the multi-select payload builder (ticket 008): turning the
 * extra picks into the `additionalAnchors` wire shape. The RN capture UI isn't
 * unit-testable here — this is the pure picks→payload + chip-removal logic.
 */
import { describe, expect, it } from 'vitest';
import { buildAdditionalAnchors, type ChipPick, removeChip } from '../src/native/multi-pick';

function chip(overrides: Partial<ChipPick> = {}): ChipPick {
  return {
    key: 'x0',
    loc: { file: 'src/Button.tsx', line: 10, col: 3 },
    selector: 'App > Home > Button',
    clickX: 100.4,
    clickY: 200.6,
    label: 'Button',
    ...overrides,
  };
}

describe('buildAdditionalAnchors', () => {
  it('omits the field (returns undefined) for a single pick — no extras', () => {
    expect(buildAdditionalAnchors([])).toBeUndefined();
  });

  it('maps each extra to the AdditionalAnchor schema shape, rounding coords', () => {
    const anchors = buildAdditionalAnchors([chip()]);
    expect(anchors).toEqual([
      {
        file: 'src/Button.tsx',
        line: 10,
        col: 3,
        selector: 'App > Home > Button',
        clickX: 100,
        clickY: 201,
      },
    ]);
  });

  it('preserves pick order on the wire', () => {
    const anchors = buildAdditionalAnchors([
      chip({ key: 'a', label: 'First', selector: 'First' }),
      chip({ key: 'b', label: 'Second', selector: 'Second' }),
      chip({ key: 'c', label: 'Third', selector: 'Third' }),
    ]);
    expect(anchors?.map((a) => a.selector)).toEqual(['First', 'Second', 'Third']);
  });

  it('carries null loc fields for an unresolvable native view', () => {
    const anchors = buildAdditionalAnchors([chip({ loc: null })]);
    expect(anchors?.[0]).toMatchObject({ file: null, line: null, col: null });
  });
});

describe('removeChip', () => {
  it('removes the chip with the given key, preserving order', () => {
    const picks = [chip({ key: 'a' }), chip({ key: 'b' }), chip({ key: 'c' })];
    expect(removeChip(picks, 'b').map((p) => p.key)).toEqual(['a', 'c']);
  });

  it('is a no-op when the key is absent', () => {
    const picks = [chip({ key: 'a' })];
    expect(removeChip(picks, 'zzz')).toEqual(picks);
  });

  it('removing the only extra leaves an empty list → additionalAnchors omitted', () => {
    const remaining = removeChip([chip({ key: 'a' })], 'a');
    expect(remaining).toEqual([]);
    expect(buildAdditionalAnchors(remaining)).toBeUndefined();
  });
});
