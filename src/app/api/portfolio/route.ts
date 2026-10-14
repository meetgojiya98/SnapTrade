import { NextResponse, type NextRequest } from 'next/server';
import { configurationRequirements } from '@/lib/server/config';
import { reconnectError, ServiceError } from '@/lib/server/errors';
import { loadPortfolio } from '@/lib/server/portfolio';
import {
  cookieNames,
  errorResponse,
  PRIVATE_HEADERS,
  sessionId,
  setPrivateCookie,
} from '@/lib/server/routes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (configurationRequirements().length)
    return errorResponse(
      new ServiceError(
        'configuration',
        503,
        'Connect a configured SnapTrade OAuth app to load live accounts.',
      ),
    );
  const id = sessionId(request);
  if (!id) return errorResponse(reconnectError());
  try {
    return NextResponse.json(await loadPortfolio(id), { headers: PRIVATE_HEADERS });
  } catch (error) {
    const response = errorResponse(error);
    if (response.status === 401) setPrivateCookie(response, cookieNames().session, '', 0);
    return response;
  }
}
