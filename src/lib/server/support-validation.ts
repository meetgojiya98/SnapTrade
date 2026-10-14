import 'server-only';
import type { NextRequest } from 'next/server';
import {
  supportLimits,
  supportTopics,
  type CreateSupportInput,
  type ReplySupportInput,
  type SupportStatus,
} from '@/lib/support';
import { ServiceError } from './errors';

export const supportUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function invalid(message: string): never {
  throw new ServiceError('invalid_input', 400, message);
}
function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('Provide a JSON object.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !fields.includes(key)))
    invalid('The request contains an unsupported field.');
  return input;
}
function message(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > supportLimits.maxMessageLength ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    invalid(`Write a message using 1 to ${supportLimits.maxMessageLength} characters.`);
  return value.trim();
}
export function validateCreateSupport(value: unknown): CreateSupportInput {
  const input = object(value, ['clientRequestId', 'topic', 'title', 'message', 'requestReference']);
  if (!supportUuid(input.clientRequestId)) invalid('Provide a valid request identifier.');
  if (
    typeof input.topic !== 'string' ||
    !supportTopics.includes(input.topic as CreateSupportInput['topic'])
  )
    invalid('Choose a support topic.');
  if (
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    input.title.trim().length > supportLimits.maxTitleLength ||
    /[\u0000-\u001f\u007f]/.test(input.title)
  )
    invalid('Use a title with 1 to 100 characters.');
  const reference =
    input.requestReference === undefined ||
    input.requestReference === null ||
    input.requestReference === ''
      ? null
      : input.requestReference;
  if (reference !== null && !supportUuid(reference))
    invalid('Use the error’s request reference, or leave it empty.');
  return {
    clientRequestId: input.clientRequestId.toLowerCase(),
    topic: input.topic as CreateSupportInput['topic'],
    title: input.title.trim(),
    message: message(input.message),
    requestReference: reference === null ? null : reference.toLowerCase(),
  };
}
export function validateSupportReply(value: unknown): ReplySupportInput {
  const input = object(value, ['clientRequestId', 'message']);
  if (!supportUuid(input.clientRequestId)) invalid('Provide a valid request identifier.');
  return { clientRequestId: input.clientRequestId.toLowerCase(), message: message(input.message) };
}
export function validateSupportStatus(value: unknown): SupportStatus {
  const input = object(value, ['status']);
  if (input.status !== 'open' && input.status !== 'resolved') invalid('Choose open or resolved.');
  return input.status;
}
export async function readSupportJson(request: NextRequest): Promise<unknown> {
  const maximum = 24_000;
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? ''))
    throw new ServiceError('invalid_content_type', 415, 'Send this request as JSON.');
  if (Number(request.headers.get('content-length')) > maximum)
    throw new ServiceError('request_too_large', 413, 'This support request is too large.');
  const reader = request.body?.getReader();
  if (!reader) invalid('Provide a JSON request body.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new ServiceError('request_too_large', 413, 'This support request is too large.');
      }
      chunks.push(chunk.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    invalid('Provide a valid JSON request body.');
  } finally {
    reader.releaseLock();
  }
}

export interface SupportCursor {
  updatedAt: string;
  id: string;
}
export function encodeSupportCursor(value: SupportCursor): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export function parseSupportCursor(value: string | null): SupportCursor | null {
  if (value === null) return null;
  if (!value || value.length > 160 || !/^[A-Za-z0-9_-]+$/.test(value))
    invalid('This support page cursor is invalid. Reload the inbox.');
  try {
    const input = object(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')), [
      'updatedAt',
      'id',
    ]);
    if (
      !supportUuid(input.id) ||
      typeof input.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(input.updatedAt)) ||
      new Date(input.updatedAt).toISOString() !== input.updatedAt
    )
      invalid('This support page cursor is invalid. Reload the inbox.');
    return { id: input.id, updatedAt: input.updatedAt };
  } catch {
    return invalid('This support page cursor is invalid. Reload the inbox.');
  }
}
