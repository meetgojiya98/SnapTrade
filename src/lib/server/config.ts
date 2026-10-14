import 'server-only';

export interface ServerConfig {
  clientId: string;
  clientSecret: string;
  appUrl: string;
  redirectUri: string;
  encryptionKey: Buffer;
  databaseUrl?: string;
  memoryStore: boolean;
  secureCookies: boolean;
}

export function configurationRequirements(env: NodeJS.ProcessEnv = process.env): string[] {
  const requirements: string[] = [];
  if (!env.SNAPTRADE_CLIENT_ID?.trim()) requirements.push('SNAPTRADE_CLIENT_ID');
  if (!env.SNAPTRADE_CLIENT_SECRET?.trim()) requirements.push('SNAPTRADE_CLIENT_SECRET');
  try {
    const app = new URL(env.APP_URL ?? '');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(app.hostname);
    if (
      app.username ||
      app.password ||
      app.pathname !== '/' ||
      app.search ||
      app.hash ||
      (app.protocol !== 'https:' &&
        !(env.NODE_ENV !== 'production' && local && app.protocol === 'http:'))
    ) {
      throw new Error('Invalid app origin');
    }
  } catch {
    requirements.push('APP_URL (HTTPS origin; loopback HTTP is allowed in development)');
  }
  const key = env.SESSION_ENCRYPTION_KEY ?? '';
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(key) || Buffer.from(key, 'base64').length !== 32) {
    requirements.push('SESSION_ENCRYPTION_KEY (32 random bytes encoded as base64)');
  }
  if (!env.DATABASE_URL && !(env.NODE_ENV !== 'production' && env.SESSION_STORE === 'memory')) {
    requirements.push('DATABASE_URL (or SESSION_STORE=memory for local development only)');
  } else if (env.DATABASE_URL) {
    try {
      const database = new URL(env.DATABASE_URL);
      if (!['postgres:', 'postgresql:'].includes(database.protocol))
        throw new Error('Invalid database');
    } catch {
      requirements.push('DATABASE_URL (valid Postgres connection URL)');
    }
  }
  return requirements;
}

export function getServerConfig(): ServerConfig {
  if (configurationRequirements().length) throw new Error('SnapTrade is not configured');
  const appUrl = new URL(process.env.APP_URL!).origin;
  return {
    clientId: process.env.SNAPTRADE_CLIENT_ID!,
    clientSecret: process.env.SNAPTRADE_CLIENT_SECRET!,
    appUrl,
    redirectUri: `${appUrl}/api/auth/callback`,
    encryptionKey: Buffer.from(process.env.SESSION_ENCRYPTION_KEY!, 'base64'),
    databaseUrl: process.env.DATABASE_URL,
    memoryStore:
      !process.env.DATABASE_URL &&
      process.env.NODE_ENV !== 'production' &&
      process.env.SESSION_STORE === 'memory',
    secureCookies: new URL(appUrl).protocol === 'https:',
  };
}
