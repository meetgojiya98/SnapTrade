export const supportTopics = [
  'connection',
  'portfolio',
  'planning',
  'saved-plans',
  'privacy',
  'other',
] as const;
export type SupportTopic = (typeof supportTopics)[number];
export type SupportRole = 'customer' | 'operator';
export type SupportStatus = 'open' | 'resolved';

export const supportLimits = {
  maxThreads: 20,
  maxMessages: 50,
  maxTitleLength: 100,
  maxMessageLength: 4_000,
  createRequestsPerHour: 3,
  customerWritesPerHour: 30,
  operatorWritesPerHour: 120,
  retentionDays: 180,
  pageSize: 25,
} as const;

export interface SupportMessage {
  id: string;
  author: SupportRole;
  body: string;
  createdAt: string;
}

export interface SupportThreadSummary {
  id: string;
  topic: SupportTopic;
  title: string;
  status: SupportStatus;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  messageCount: number;
  lastMessageRole: SupportRole;
  requestReference: string | null;
  canDelete: boolean;
}

export interface SupportThread extends SupportThreadSummary {
  messages: SupportMessage[];
}

export interface SupportCollection {
  role: SupportRole;
  /** This authenticated viewer's deterministic identity hash, for explicit operator setup. */
  viewerKey: string;
  acceptingRequests: boolean;
  limits: typeof supportLimits;
  threads: SupportThreadSummary[];
  nextCursor: string | null;
}

export interface CreateSupportInput {
  clientRequestId: string;
  topic: SupportTopic;
  title: string;
  message: string;
  requestReference: string | null;
}

export interface ReplySupportInput {
  clientRequestId: string;
  message: string;
}
