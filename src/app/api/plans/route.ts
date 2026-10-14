import { NextResponse, type NextRequest } from 'next/server';
import { ServiceError } from '@/lib/server/errors';
import { validateSavePlanInput, validPlanId } from '@/lib/server/preferences';
import { errorResponse, PRIVATE_HEADERS } from '@/lib/server/routes';
import { authenticateWorkspace, createSavedPlan, readWorkspaceJson } from '@/lib/server/workspace';
import { getWorkspaceStore } from '@/lib/server/workspace-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { subject } = await authenticateWorkspace(request);
    const id = request.nextUrl.searchParams.get('id');
    if (id !== null) {
      if (!validPlanId(id))
        throw new ServiceError('invalid_input', 400, 'Provide a valid plan ID.');
      const plan = await getWorkspaceStore().readPlan(subject, id);
      if (!plan)
        throw new ServiceError('plan_not_found', 404, 'This saved plan could not be found.');
      return NextResponse.json({ plan }, { headers: PRIVATE_HEADERS });
    }
    return NextResponse.json(
      { plans: await getWorkspaceStore().listPlans(subject) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const identity = await authenticateWorkspace(request, true);
    const input = validateSavePlanInput(await readWorkspaceJson(request));
    return NextResponse.json(
      { plan: await createSavedPlan(identity, input) },
      { status: 201, headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
