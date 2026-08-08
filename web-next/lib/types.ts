// Kiểu dữ liệu khớp với những gì src/server/index.js trả về.

export type Status = 'RUNNING' | 'ACTIVE' | 'IDLE';

export interface Session {
  sid: string;
  project: string;
  title: string;
  msgs: number;
  unread: number;
  mtimeMs: number;
  status: Status;
  model?: string | null;
}

export interface Job {
  id: string;
  kind: 'loop' | 'cron';
  spec: string;
  prompt: string;
  runs: number;
  lastSid?: string | null;
}

export interface StreamData {
  sessions: Session[];
  jobs: Job[];
  model: string | null;
  perm: string;
}

// ---- agy-proxy ----
export interface AgyAccounts {
  total: number;
  status: Record<string, number>;
  kiro: Record<string, number>;
  recent24h: number;
}

export interface AgyUsage {
  ok: boolean;
  reqs: number;
  errs: number;
  tokens: number;
  avgMs: number;
  models: { model: string; n: number; e: number }[];
  codes: { status: number | null; n: number }[];
  hours: { h: string; n: number; e: number }[];
}

export interface AgyStatus {
  running: boolean;
  port: number;
  accounts: number;
  models: string[];
  modelGroups: { name: string; items: string[] }[];
  acc: AgyAccounts;
  usage: AgyUsage | { ok: false };
  external: boolean;
  dev: { pid: number; startedAt: number } | null;
  task: { name: string; startedAt: number } | null;
  last: Record<string, { ok: boolean; at: number; ms?: number } | null>;
}
