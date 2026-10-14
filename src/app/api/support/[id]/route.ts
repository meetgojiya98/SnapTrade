import { NextResponse, type NextRequest } from 'next/server';
import { ServiceError } from '@/lib/server/errors';
import { errorResponse, PRIVATE_HEADERS } from '@/lib/server/routes';
import { authenticateSupport, requireSupportAvailable } from '@/lib/server/support-auth';
import { getSupportStore } from '@/lib/server/support-store';
import {
  readSupportJson,
  supportUuid,
  validateSupportStatus,
} from '@/lib/server/support-validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
async function threadId(context: Context) {
  const { id } = await context.params;
  if (!supportUuid(id))
    throw new ServiceError('invalid_input', 400, 'Provide a valid support request ID.');
  return id.toLowerCase();
}

export async function GET(request: NextRequest, context: Context) {
  try {
    const actor = await authenticateSupport(request);
    return NextResponse.json(
      { thread: await getSupportStore().readThread(actor, await threadId(context)) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const actor = await authenticateSupport(request, true);
    const id = await threadId(context);
    const status = validateSupportStatus(await readSupportJson(request));
    if (status === 'open') requireSupportAvailable();
    return NextResponse.json(
      { thread: await getSupportStore().setStatus(actor, id, status) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: Context) {
  try {
    const actor = await authenticateSupport(request, true);
    await getSupportStore().deleteThread(actor, await threadId(context));
    return NextResponse.json({ deleted: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
