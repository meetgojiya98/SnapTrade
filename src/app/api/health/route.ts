import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'balance', version: 1 },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
