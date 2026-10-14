import { NextResponse, type NextRequest } from 'next/server';
import { configurationRequirements, getServerConfig } from '@/lib/server/config';
import { ServiceError } from '@/lib/server/errors';
import { invalidatePortfolioSession } from '@/lib/server/portfolio-cache';
import {
  cookieNames,
  errorResponse,
  PRIVATE_HEADERS,
  sessionId,
  setPrivateCookie,
} from '@/lib/server/routes';
import { getSessionStore } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (configurationRequirements().length)
    return errorResponse(new ServiceError('configuration', 503, 'SnapTrade is not configured.'));
  if (request.headers.get('origin') !== getServerConfig().appUrl)
    return errorResponse(
      new ServiceError('invalid_origin', 403, 'This request must come from this app.'),
    );
  try {
    const id = sessionId(request);
    let warning: string | undefined;
    if (id) {
      // Signing out ends this browser session. Disconnecting the provider is a separate action.
      // Keep the cookie on failure so the browser can retry invalidating its server credentials.
      await getSessionStore().deleteSession(id);
      try {
        await invalidatePortfolioSession(id);
      } catch {
        warning =
          'Cleanup of the encrypted temporary snapshot could not be confirmed. Your ended session cannot access it.';
      }
    }
    const response = NextResponse.json(
      { signedOut: true, ...(warning ? { warning } : {}) },
      { headers: PRIVATE_HEADERS },
    );
    const names = cookieNames();
    setPrivateCookie(response, names.session, '', 0);
    setPrivateCookie(response, names.login, '', 0);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
