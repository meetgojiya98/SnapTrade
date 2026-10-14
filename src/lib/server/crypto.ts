import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export const randomSecret = () => randomBytes(32).toString('base64url');
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
export const pkceChallenge = (verifier: string) =>
  createHash('sha256').update(verifier).digest('base64url');
export const validSecret = (value: string | undefined | null): value is string =>
  Boolean(value && /^[A-Za-z0-9_-]{43}$/.test(value));

export function secretsEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** AAD binds each ciphertext to its row so a copied ciphertext cannot authenticate elsewhere. */
export function encryptJson(value: unknown, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptJson<T>(value: string, key: Buffer, context: string): T {
  const [version, nonce, tag, ciphertext, extra] = value.split('.');
  if (version !== 'v1' || !nonce || !tag || !ciphertext || extra)
    throw new Error('Invalid encrypted session');
  const iv = Buffer.from(nonce, 'base64url');
  const authenticationTag = Buffer.from(tag, 'base64url');
  if (iv.length !== 12 || authenticationTag.length !== 16)
    throw new Error('Invalid encrypted session');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(authenticationTag);
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8'),
  ) as T;
}
