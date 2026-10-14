import type { NextRequest } from 'next/server';
import { configurationRequirements } from '@/lib/server/config';
import { safeError } from '@/lib/server/errors';
import { getOAuthService } from '@/lib/server/oauth';
import { cookieNames, homeRedirect, sessionId, setPrivateCookie } from '@/lib/server/routes';
import { getSessionStore, SESSION_TTL_MS } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (configurationRequirements().length) return homeRedirect(request, 'configuration');
  const names = cookieNames();
  try {
    const query = request.nextUrl.searchParams;
    const id = await getOAuthService().finishLogin({
      state: query.get('state'),
      code: query.get('code'),
      issuer: query.get('iss'),
      error: query.get('error'),
      browser: request.cookies.get(names.login)?.value,
    });
    const previousId = sessionId(request);
    if (previousId) await getSessionStore().deleteSession(previousId);
    const response = homeRedirect(request);
    setPrivateCookie(response, names.login, '', 0);
    setPrivateCookie(response, names.session, id, SESSION_TTL_MS / 1000);
    return response;
  } catch (error) {
    const safe = safeError(error);
    const response = homeRedirect(request, safe.code);
    setPrivateCookie(response, names.login, '', 0);
    return response;
  }
}
