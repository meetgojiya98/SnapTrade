import { describe, expect, it } from 'vitest';
import { csvCell, inputCents } from './inputs';

describe('money input boundary', () => {
  it('does not treat blank, malformed, or excess-precision values as usable money', () => {
    for (const value of ['', ' ', '-10', '1e3', '12.345', 'NaN', '10000000000000000'])
      expect(Number.isNaN(inputCents(value))).toBe(true);
  });
  it('converts explicit zero and decimal amounts exactly to safe cents', () => {
    expect(inputCents('0')).toBe(0);
    expect(inputCents('1000')).toBe(100000);
    expect(inputCents('0.29')).toBe(29);
    expect(inputCents('1.5')).toBe(150);
  });
});
describe('CSV export boundary', () => {
  it('neutralizes formula prefixes from external account and instrument names', () => {
    for (const value of [
      '=WEBSERVICE("https://example.invalid")',
      '+1+1',
      '-1+1',
      '@SUM(A1)',
      '  =1+1',
      '\t=1+1',
      '\r=1+1',
    ])
      expect(csvCell(value).startsWith('"\'')).toBe(true);
    expect(csvCell('Normal "account"')).toBe('"Normal ""account"""');
    expect(csvCell(3)).toBe('"3"');
  });
});
