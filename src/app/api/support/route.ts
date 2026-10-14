import { NextResponse, type NextRequest } from 'next/server';
import { supportLimits } from '@/lib/support';
import { ServiceError } from '@/lib/server/errors';
import { errorResponse, PRIVATE_HEADERS } from '@/lib/server/routes';
import {
  authenticateSupport,
  requireSupportAvailable,
  supportAcceptingRequests,
  supportOwnerHash,
} from '@/lib/server/support-auth';
import { getSupportStore } from '@/lib/server/support-store';
import {
  parseSupportCursor,
  readSupportJson,
  validateCreateSupport,
} from '@/lib/server/support-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const actor = await authenticateSupport(request);
    const scope = request.nextUrl.searchParams.get('scope') ?? 'mine';
    if (scope !== 'mine' && scope !== 'all')
      throw new ServiceError('invalid_input', 400, 'Choose your requests or the operator inbox.');
    const page = await getSupportStore().listThreads(
      actor,
      scope,
      parseSupportCursor(request.nextUrl.searchParams.get('cursor')),
    );
    return NextResponse.json(
      {
        role: actor.operator ? 'operator' : 'customer',
        viewerKey: supportOwnerHash(actor.subject),
        acceptingRequests: supportAcceptingRequests(),
        limits: supportLimits,
        ...page,
      },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await authenticateSupport(request, true);
    requireSupportAvailable();
    const store = getSupportStore();
    // Capture before reading the body so a pending request cannot undo a completed privacy deletion.
    const generation = await store.dataGeneration(actor.subject);
    const input = validateCreateSupport(await readSupportJson(request));
    const result = await store.createThread(actor, input, generation);
    return NextResponse.json(
      { thread: result.thread },
      { status: result.replayed ? 200 : 201, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const actor = await authenticateSupport(request, true);
    await getSupportStore().deleteAll(actor);
    return NextResponse.json({ deleted: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
