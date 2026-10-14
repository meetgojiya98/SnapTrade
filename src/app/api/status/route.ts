import { NextResponse, type NextRequest } from 'next/server';
import { configurationRequirements } from '@/lib/server/config';
import { getSessionStore } from '@/lib/server/store';
import { PRIVATE_HEADERS, sessionId } from '@/lib/server/routes';

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
    const id = sessionId(request);
    const connected = Boolean(id && (await getSessionStore().readSession(id)));
    return NextResponse.json(
      { configured: true, connected, requirements: [] },
      { headers: PRIVATE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      {
        configured: false,
        connected: false,
        requirements: [
          'Session database unavailable. Apply migrations/001_sessions.sql and verify DATABASE_URL.',
        ],
      },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
}
