import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { configurationRequirements } from '@/lib/server/config';
import { getOAuthService } from '@/lib/server/oauth';
import { cookieNames, homeRedirect, PRIVATE_HEADERS, setPrivateCookie } from '@/lib/server/routes';
import { LOGIN_TTL_MS } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (configurationRequirements().length) return homeRedirect(request, 'configuration');
  try {
    const login = await getOAuthService().beginLogin();
    const response = NextResponse.redirect(login.url, { status: 303, headers: PRIVATE_HEADERS });
    setPrivateCookie(response, cookieNames().login, login.browser, LOGIN_TTL_MS / 1000);
    return response;
  } catch {
    return homeRedirect(request, 'connection_unavailable');
  }
}
