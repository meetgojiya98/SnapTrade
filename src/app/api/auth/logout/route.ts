import { NextResponse, type NextRequest } from 'next/server';
import { configurationRequirements, getServerConfig } from '@/lib/server/config';
import { ServiceError } from '@/lib/server/errors';
import { getOAuthService } from '@/lib/server/oauth';
import { invalidatePortfolioSession } from '@/lib/server/portfolio-cache';
import {
  cookieNames,
  errorResponse,
  PRIVATE_HEADERS,
  sessionId,
  setPrivateCookie,
} from '@/lib/server/routes';

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
    const result = id ? await getOAuthService().disconnect(id) : { revoked: true };
    const warnings: string[] = [];
    if (!result.revoked)
      warnings.push(
        'Local credentials were deleted, but remote revocation could not be confirmed. Remove this app in your SnapTrade dashboard.',
      );
    if (id) {
      try {
        await invalidatePortfolioSession(id);
      } catch {
        warnings.push(
          'Cleanup of the encrypted temporary snapshot could not be confirmed. Your ended session cannot access it.',
        );
      }
    }
    const response = NextResponse.json(
      {
        disconnected: true,
        revoked: result.revoked,
        ...(warnings.length ? { warning: warnings.join(' ') } : {}),
      },
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
