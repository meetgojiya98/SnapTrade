import { NextResponse, type NextRequest } from 'next/server';
import { validateWorkspaceInput } from '@/lib/server/preferences';
import { invalidatePortfolioOwner } from '@/lib/server/portfolio-cache';
import { errorResponse, PRIVATE_HEADERS } from '@/lib/server/routes';
import { authenticateWorkspace, readWorkspaceJson } from '@/lib/server/workspace';
import { getWorkspaceStore } from '@/lib/server/workspace-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { subject } = await authenticateWorkspace(request);
    return NextResponse.json(await getWorkspaceStore().readWorkspace(subject), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { subject } = await authenticateWorkspace(request, true);
    const store = getWorkspaceStore();
    const generation = await store.dataGeneration(subject);
    const preferences = validateWorkspaceInput(await readWorkspaceJson(request));
    return NextResponse.json(await store.writeWorkspace(subject, preferences, generation), {
      headers: PRIVATE_HEADERS,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { subject } = await authenticateWorkspace(request, true);
    await getWorkspaceStore().deleteWorkspace(subject);
    let warning: string | undefined;
    try {
      await invalidatePortfolioOwner(subject);
    } catch {
      warning =
        'Saved preferences and plans were deleted, but cleanup of encrypted temporary snapshots could not be confirmed. Older snapshots are invalidated and cannot be reused.';
    }
    return NextResponse.json(
      { deleted: true, ...(warning ? { warning } : {}) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
