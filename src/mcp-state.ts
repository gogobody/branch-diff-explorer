import type { SessionUiConfig } from './filter';
import type { SnapshotRequest } from './types';

export interface ExplorerSession {
  id: string;
  name: string;
  config: SnapshotRequest & { repositoryPath?: string; ui?: SessionUiConfig };
}

export interface McpRepositorySettings {
  defaultBaseBranch: string;
  maxChangedLines: number;
  gitMaxOutputBufferMB: number;
  gitCommandTimeoutMs: number;
}

export interface McpState {
  version: 1;
  updatedAt: string;
  activeSessionId?: string;
  sessions: ExplorerSession[];
  repositories: Record<string, McpRepositorySettings>;
}

export function parseMcpState(value: unknown): McpState {
  if (!value || typeof value !== 'object') throw new Error('The MCP state file does not contain an object.');
  const raw = value as Partial<McpState>;
  if (raw.version !== 1 || !Array.isArray(raw.sessions) || !raw.repositories || typeof raw.repositories !== 'object') {
    throw new Error('The MCP state file has an unsupported format. Open Branch Diff Explorer and refresh it.');
  }
  const sessions = raw.sessions.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const session = candidate as Partial<ExplorerSession>;
    return typeof session.id === 'string'
      && typeof session.name === 'string'
      && session.config
      && typeof session.config === 'object'
      ? [{ id: session.id, name: session.name, config: session.config }]
      : [];
  });
  if (!sessions.length) throw new Error('The MCP state file does not contain any valid diff sessions.');
  return {
    version: 1,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    activeSessionId: typeof raw.activeSessionId === 'string' ? raw.activeSessionId : undefined,
    sessions,
    repositories: raw.repositories as Record<string, McpRepositorySettings>,
  };
}
