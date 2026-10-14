import { NextResponse, type NextRequest } from 'next/server';
import { ServiceError } from '@/lib/server/errors';
import { errorResponse, PRIVATE_HEADERS } from '@/lib/server/routes';
import { authenticateSupport, requireSupportAvailable } from '@/lib/server/support-auth';
import { getSupportStore } from '@/lib/server/support-store';
import {
  readSupportJson,
  supportUuid,
  validateSupportReply,
} from '@/lib/server/support-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateSupport(request, true);
    requireSupportAvailable();
    const { id } = await context.params;
    if (!supportUuid(id))
      throw new ServiceError('invalid_input', 400, 'Provide a valid support request ID.');
    const input = validateSupportReply(await readSupportJson(request));
    return NextResponse.json(
      { thread: await getSupportStore().reply(actor, id.toLowerCase(), input) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
