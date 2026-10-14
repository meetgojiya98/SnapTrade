import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { getServerConfig } from './config';
import { safeError } from './errors';
import { validSecret } from './crypto';

export const PRIVATE_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
};

export function cookieNames() {
  const secure = getServerConfig().secureCookies;
  return {
    session: secure ? '__Host-balance_session' : 'balance_session',
    login: secure ? '__Host-balance_login' : 'balance_login',
  };
}

export function sessionId(request: NextRequest): string | null {
  const id = request.cookies.get(cookieNames().session)?.value;
  return validSecret(id) ? id : null;
}

export function setPrivateCookie(
  response: NextResponse,
  name: string,
  value: string,
  maxAge: number,
) {
  response.cookies.set(name, value, {
    httpOnly: true,
    secure: getServerConfig().secureCookies,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function errorResponse(error: unknown): NextResponse {
  const safe = safeError(error);
  return NextResponse.json(
    { error: safe.message, code: safe.code },
    {
      status: safe.status,
      headers: {
        ...PRIVATE_HEADERS,
        ...(safe.retryAfter ? { 'Retry-After': safe.retryAfter } : {}),
      },
    },
  );
}

export function homeRedirect(request: NextRequest, error?: string): NextResponse {
  let origin = request.nextUrl.origin;
  try {
    origin = getServerConfig().appUrl;
  } catch {
    /* Configuration failure has no configured destination. */
  }
  const url = new URL('/', origin);
  if (error) url.searchParams.set('error', error);
  return NextResponse.redirect(url, { status: 303, headers: PRIVATE_HEADERS });
}
