/** Blank or malformed inputs stay invalid instead of silently removing a constraint. */
export function inputCents(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return NaN;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : NaN;
}

/** Quoting alone does not stop spreadsheet applications from evaluating a formula. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)))
    text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
