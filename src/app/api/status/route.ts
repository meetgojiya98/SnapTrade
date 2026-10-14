import { NextResponse, type NextRequest } from 'next/server';
import { configurationRequirements } from '@/lib/server/config';
import { getSessionStore } from '@/lib/server/store';
import { PRIVATE_HEADERS, sessionId } from '@/lib/server/routes';
import { assertDatabaseReady } from '@/lib/server/readiness';
import { failureReference } from '@/lib/server/diagnostics';
import { ServiceError } from '@/lib/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const requirements = configurationRequirements();
  if (requirements.length)
    return NextResponse.json(
      { configured: false, connected: false, requirements },
      { headers: PRIVATE_HEADERS },
    );
  try {
    await assertDatabaseReady();
    const id = sessionId(request);
    const connected = Boolean(id && (await getSessionStore().readSession(id)));
    return NextResponse.json(
      { configured: true, connected, requirements: [] },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    const requestId = failureReference(new ServiceError('database_unavailable', 503));
    return NextResponse.json(
      {
        error: 'The workspace service is temporarily unavailable. Please try again.',
        code: 'database_unavailable',
        requestId,
        configured: false,
        connected: false,
        requirements: [
          'Workspace database unavailable. Verify the database connection and apply all migrations.',
        ],
      },
      { status: 503, headers: { ...PRIVATE_HEADERS, 'X-Request-Id': requestId } },
    );
  }
}
