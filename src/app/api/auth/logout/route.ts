import { NextResponse, type NextRequest } from 'next/server';
import { configurationRequirements, getServerConfig } from '@/lib/server/config';
import { ServiceError } from '@/lib/server/errors';
import { getOAuthService } from '@/lib/server/oauth';
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
    const response = NextResponse.json(
      {
        disconnected: true,
        revoked: result.revoked,
        ...(result.revoked
          ? {}
          : {
              warning:
                'Local credentials were deleted, but remote revocation could not be confirmed. Remove this app in your SnapTrade dashboard.',
            }),
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
