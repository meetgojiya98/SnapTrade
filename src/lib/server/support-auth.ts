import 'server-only';
import type { NextRequest } from 'next/server';
import { hashSecret } from './crypto';
import { ServiceError } from './errors';
import { authenticateWorkspace } from './workspace';

export interface SupportActor {
  subject: string;
  operator: boolean;
}
/** Identical to the existing workspace identity namespace. Never use a client-supplied hash as identity. */
export const supportOwnerHash = (subject: string) => hashSecret(`balance:subject:${subject}`);
export function supportOperatorHashes(
  env: { SUPPORT_ADMIN_SUBJECT_HASHES?: string } = {
    SUPPORT_ADMIN_SUBJECT_HASHES: process.env.SUPPORT_ADMIN_SUBJECT_HASHES,
  },
): Set<string> {
  const value = env.SUPPORT_ADMIN_SUBJECT_HASHES?.trim();
  if (!value) return new Set();
  const hashes = value.split(',').map((hash) => hash.trim().toLowerCase());
  if (hashes.length > 20 || hashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) return new Set();
  return new Set(hashes);
}
export const supportAcceptingRequests = () => supportOperatorHashes().size > 0;
export function requireSupportAvailable() {
  if (!supportAcceptingRequests())
    throw new ServiceError(
      'support_unavailable',
      503,
      'Private support is not accepting messages yet. You can still read or delete existing requests.',
    );
}
export async function authenticateSupport(
  request: NextRequest,
  mutation = false,
): Promise<SupportActor> {
  const identity = await authenticateWorkspace(request, mutation);
  return {
    subject: identity.subject,
    operator: supportOperatorHashes().has(supportOwnerHash(identity.subject)),
  };
}
