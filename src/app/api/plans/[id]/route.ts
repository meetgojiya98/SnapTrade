import { NextResponse, type NextRequest } from 'next/server';
import { ServiceError } from '@/lib/server/errors';
import { validPlanId } from '@/lib/server/preferences';
import { errorResponse, PRIVATE_HEADERS } from '@/lib/server/routes';
import { authenticateWorkspace } from '@/lib/server/workspace';
import { getWorkspaceStore } from '@/lib/server/workspace-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { subject } = await authenticateWorkspace(request, true);
    const { id } = await context.params;
    if (!validPlanId(id)) throw new ServiceError('invalid_input', 400, 'Provide a valid plan ID.');
    if (!(await getWorkspaceStore().deletePlan(subject, id)))
      throw new ServiceError('plan_not_found', 404, 'This saved plan could not be found.');
    return NextResponse.json({ deleted: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error);
  }
}
