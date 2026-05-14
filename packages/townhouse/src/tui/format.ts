const DECIMAL_RE = /^-?\d+$/;

export function formatUsdc(decimalString: string, scale: number): string {
  if (!DECIMAL_RE.test(decimalString)) {
    const env = process.env['NODE_ENV'];
    if (env === 'development' || env === 'test') {
      throw new Error(`formatUsdc: invalid decimal string: ${JSON.stringify(decimalString)}`);
    }
    return '$?.??';
  }

  const negative = decimalString.startsWith('-');
  const abs = negative ? decimalString.slice(1) : decimalString;

  const divisor = BigInt(10) ** BigInt(scale);
  const value = BigInt(abs);

  // Truncate (do NOT round) — connector posture.
  const whole = value / divisor;
  const remainder = value % divisor;

  const fractionalStr = remainder.toString().padStart(scale, '0');
  const cents = fractionalStr.slice(0, 2).padEnd(2, '0');

  const formatted = `$${whole.toString()}.${cents}`;
  // Suppress `-$0.00` — value === 0n collapses negative zero.
  return negative && value !== 0n ? `-${formatted}` : formatted;
}
