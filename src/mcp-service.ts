import { lstat, readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { authorId, GitRepository, parsePatch, revertPatchWithDiagnostics, type GitRunOptions } from './git';
import { matchingChangedLines, normalizeSessionUi, visibleChangedFiles, type SessionUiConfig } from './filter';
import { parseMcpState, type ExplorerSession, type McpRepositorySettings, type McpState } from './mcp-state';
import type { ChangedFile, CommitRecord, DiffSnapshot } from './types';

const CACHE_TTL_MS = 5_000;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 200;
const DEFAULT_TEXT_LINES = 800;
const MAX_TEXT_LINES = 5_000;
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

interface SessionSnapshot {
  state: McpState;
  session: ExplorerSession;
  settings: McpRepositorySettings;
  repository: GitRepository;
  snapshot: DiffSnapshot;
  visibleFiles: ChangedFile[];
}

interface SnapshotCacheEntry {
  createdAt: number;
  stateModifiedAt: number;
  value: SessionSnapshot;
}

export interface PageRequest {
  cursor?: number;
  limit?: number;
}

export interface TextPageRequest {
  startLine?: number;
  maxLines?: number;
}

export class BranchDiffMcpService {
  private readonly cache = new Map<string, SnapshotCacheEntry>();

  constructor(readonly statePath: string) {}

  async listSessions(): Promise<object> {
    const state = await this.loadState();
    return {
      activeSessionId: state.activeSessionId,
      updatedAt: state.updatedAt,
      sessions: state.sessions.map((session) => ({
        id: session.id,
        name: session.name,
        repositoryPath: session.config.repositoryPath,
        baseBranch: session.config.baseBranch,
        authorKeyword: session.config.authorKeyword,
        authorIds: session.config.authorIds ?? [],
        commitHash: session.config.commitHash,
        filters: normalizeSessionUi(session.config.ui),
      })),
    };
  }

  async getSummary(sessionId?: string, refresh = false): Promise<object> {
    const current = await this.sessionSnapshot(sessionId, refresh);
    const visibleTotals = totals(current.visibleFiles);
    return {
      session: sessionDescription(current),
      scopeTotals: current.snapshot.totals,
      visibleTotals,
      hiddenFiles: Math.max(0, current.snapshot.totals.files - visibleTotals.files),
      truncatedChangedLinePreview: current.snapshot.truncated,
      behindBase: current.snapshot.behindBase,
      notice: current.snapshot.notice,
      filterSemantics: current.snapshot.activeAuthorIds.length || current.snapshot.activeAuthorKeyword
        ? 'Filtered patches contain only matching-author commits; file totals match the final author-before-to-working-tree diff shown by the editor.'
        : current.snapshot.activeCommit
          ? 'Filtered patches contain only the selected commit.'
          : 'Filtered patches contain the complete base-to-working-tree changes plus staged and unstaged changes.',
    };
  }

  async listFiles(sessionId: string | undefined, request: PageRequest & { pathPrefix?: string }): Promise<object> {
    const current = await this.sessionSnapshot(sessionId);
    const prefix = normalizePathPrefix(request.pathPrefix);
    const files = current.visibleFiles
      .filter((file) => !prefix || file.path === prefix || file.path.startsWith(`${prefix}/`))
      .sort((left, right) => left.path.localeCompare(right.path));
    const page = pageValues(files, request);
    return {
      sessionId: current.session.id,
      repositoryPath: current.snapshot.repository.path,
      total: files.length,
      cursor: page.cursor,
      nextCursor: page.nextCursor,
      files: page.values.map((file) => ({
        path: file.path,
        previousPath: file.previousPath,
        status: file.status,
        source: file.source,
        sources: file.sources ?? [file.source],
        additions: file.additions,
        deletions: file.deletions,
        commitHash: file.commitHash,
      })),
    };
  }

  async getFilteredDiff(sessionId: string | undefined, path: string, request: TextPageRequest): Promise<object> {
    const current = await this.sessionSnapshot(sessionId);
    const file = requireVisibleFile(current, path);
    return {
      sessionId: current.session.id,
      path: file.path,
      status: file.status,
      source: file.source,
      additions: file.additions,
      deletions: file.deletions,
      authorKeyword: current.snapshot.activeAuthorKeyword || undefined,
      authorIds: current.snapshot.activeAuthorIds,
      commitHash: current.snapshot.activeCommit,
      ...textPage(file.patch, request),
    };
  }

  async getBranchDiff(sessionId: string | undefined, path: string, request: TextPageRequest): Promise<object> {
    const current = await this.sessionSnapshot(sessionId);
    const file = requireVisibleFile(current, path);
    const patch = await current.repository.filePatchFromBase(current.snapshot.repository.baseBranch, file.path);
    return {
      sessionId: current.session.id,
      path: file.path,
      baseBranch: current.snapshot.repository.baseBranch,
      comparison: 'merge-base to working tree',
      ...textPage(patch, request),
    };
  }

  async readFileContext(
    sessionId: string | undefined,
    path: string,
    side: 'current' | 'head' | 'base' | 'author_before',
    request: TextPageRequest,
  ): Promise<object> {
    const current = await this.sessionSnapshot(sessionId);
    const file = requireVisibleFile(current, path);
    let content: string;
    let ref: string;
    if (side === 'base') {
      ref = await current.repository.comparisonBase(current.snapshot.repository.baseBranch);
      content = await contentAtOrEmpty(current.repository, ref, file.previousPath ?? file.path);
    } else if (side === 'head') {
      ref = 'HEAD';
      content = await contentAtOrEmpty(current.repository, ref, file.path);
    } else {
      ref = side === 'author_before' ? 'current file with selected-author patch reverted' : 'working tree';
      content = await readWorkingFile(current.snapshot.repository.path, file.path);
      if (side === 'author_before') {
        if (file.source !== 'author') throw new Error('author_before is available only when the session has an author filter.');
        content = revertPatchWithDiagnostics(content, file.patch).content;
      }
    }
    ensureText(content, file.path);
    return {
      sessionId: current.session.id,
      path: file.path,
      side,
      ref,
      ...textPage(content, request),
    };
  }

  async listMatchingCommits(sessionId: string | undefined, request: PageRequest): Promise<object> {
    const current = await this.sessionSnapshot(sessionId);
    const commits = matchingCommits(current.snapshot);
    const page = pageValues(commits, request);
    return {
      sessionId: current.session.id,
      total: commits.length,
      cursor: page.cursor,
      nextCursor: page.nextCursor,
      commits: page.values,
    };
  }

  async searchChanges(
    sessionId: string | undefined,
    query: string,
    options: PageRequest & { caseSensitive?: boolean; regex?: boolean; wholeWord?: boolean },
  ): Promise<object> {
    if (!query.trim()) throw new Error('query must not be empty.');
    const current = await this.sessionSnapshot(sessionId);
    const ui: SessionUiConfig = {
      ...current.session.config.ui,
      query,
      caseSensitive: options.caseSensitive ?? current.session.config.ui?.caseSensitive,
      regex: options.regex ?? current.session.config.ui?.regex,
      wholeWord: options.wholeWord ?? current.session.config.ui?.wholeWord,
    };
    const expanded = current.snapshot.files.map((file) => ({
      ...file,
      lines: parsePatch(file.patch, file.source, file.commitHash).flatMap((part) => part.lines),
    }));
    const results = visibleChangedFiles(expanded, ui).flatMap((file) => {
      return matchingChangedLines(file, ui).map((line) => ({
        path: file.path,
        status: file.status,
        kind: line.kind,
        line: line.line,
        text: line.text,
      }));
    });
    const page = pageValues(results, options);
    return {
      sessionId: current.session.id,
      query,
      total: results.length,
      cursor: page.cursor,
      nextCursor: page.nextCursor,
      matches: page.values,
    };
  }

  private async sessionSnapshot(sessionId?: string, refresh = false): Promise<SessionSnapshot> {
    const stateModifiedAt = (await stat(this.statePath)).mtimeMs;
    const state = await this.loadState();
    const session = resolveSession(state, sessionId);
    const cached = this.cache.get(session.id);
    if (!refresh && cached
      && cached.stateModifiedAt === stateModifiedAt
      && Date.now() - cached.createdAt < CACHE_TTL_MS) return cached.value;
    const repositoryPath = session.config.repositoryPath;
    if (!repositoryPath) throw new Error(`Session “${session.name}” does not have a workspace folder. Open it in Branch Diff Explorer and refresh.`);
    if (!isAbsolute(repositoryPath)) throw new Error(`Session “${session.name}” does not contain an absolute repository path.`);
    const settings = normalizedRepositorySettings(state.repositories[repositoryPath]);
    if (!await GitRepository.isRepository(repositoryPath, gitOptions(settings))) {
      throw new Error(`Session “${session.name}” points to a missing or invalid Git repository: ${repositoryPath}`);
    }
    const repository = new GitRepository(repositoryPath, gitOptions(settings));
    const snapshot = await repository.snapshot(
      session.config,
      settings.defaultBaseBranch,
      settings.maxChangedLines,
    );
    const value = {
      state,
      session,
      settings,
      repository,
      snapshot,
      visibleFiles: visibleChangedFiles(snapshot.files, session.config.ui),
    };
    this.cache.set(session.id, { createdAt: Date.now(), stateModifiedAt, value });
    return value;
  }

  private async loadState(): Promise<McpState> {
    let contents: string;
    try {
      contents = await readFile(this.statePath, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read Branch Diff Explorer MCP state at ${this.statePath}: ${errorMessage(error)}`);
    }
    try {
      return parseMcpState(JSON.parse(contents));
    } catch (error) {
      throw new Error(`Cannot parse Branch Diff Explorer MCP state: ${errorMessage(error)}`);
    }
  }
}

function resolveSession(state: McpState, sessionId?: string): ExplorerSession {
  const id = sessionId || state.activeSessionId;
  const session = (id ? state.sessions.find((candidate) => candidate.id === id) : undefined) ?? state.sessions[0];
  if (!session) throw new Error('No Branch Diff Explorer session is available.');
  if (sessionId && session.id !== sessionId) throw new Error(`Unknown Branch Diff Explorer session: ${sessionId}`);
  return session;
}

function requireVisibleFile(current: SessionSnapshot, path: string): ChangedFile {
  const normalized = normalizeRepositoryPath(path);
  const file = current.visibleFiles.find((candidate) => candidate.path === normalized);
  if (!file) throw new Error(`The path is not visible in session “${current.session.name}”: ${path}`);
  safeTarget(current.snapshot.repository.path, file.path);
  return file;
}

function normalizeRepositoryPath(path: string): string {
  return path.trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function normalizePathPrefix(path: string | undefined): string {
  return path ? normalizeRepositoryPath(path).replace(/^\/+/, '') : '';
}

function safeTarget(repositoryPath: string, path: string): string {
  const target = resolve(repositoryPath, path);
  const targetRelative = relative(repositoryPath, target);
  if (targetRelative === '..' || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative)) {
    throw new Error(`Refusing to read a path outside the repository: ${path}`);
  }
  return target;
}

async function readWorkingFile(repositoryPath: string, path: string): Promise<string> {
  const target = safeTarget(repositoryPath, path);
  const details = await lstat(target);
  if (details.isSymbolicLink()) throw new Error(`Symbolic-link targets are not read through MCP: ${path}`);
  if (details.size > MAX_SOURCE_BYTES) throw new Error(`The file is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB: ${path}`);
  return readFile(target, 'utf8');
}

async function contentAtOrEmpty(repository: GitRepository, ref: string, path: string): Promise<string> {
  try {
    return await repository.contentAt(ref, path);
  } catch {
    return '';
  }
}

function matchingCommits(snapshot: DiffSnapshot): CommitRecord[] {
  if (snapshot.activeCommit) return snapshot.commits.filter((commit) => commit.hash === snapshot.activeCommit);
  const selected = new Set(snapshot.activeAuthorIds);
  const keyword = snapshot.activeAuthorKeyword.toLocaleLowerCase();
  return snapshot.commits.filter((commit) => {
    const selectedMatch = !selected.size || selected.has(authorId(commit.authorName, commit.authorEmail));
    const keywordMatch = !keyword || `${commit.authorName} ${commit.authorEmail}`.toLocaleLowerCase().includes(keyword);
    return selectedMatch && keywordMatch;
  });
}

function sessionDescription(current: SessionSnapshot): object {
  return {
    id: current.session.id,
    name: current.session.name,
    repositoryPath: current.snapshot.repository.path,
    branch: current.snapshot.repository.branch,
    baseBranch: current.snapshot.repository.baseBranch,
    authorIds: current.snapshot.activeAuthorIds,
    authorKeyword: current.snapshot.activeAuthorKeyword,
    commitHash: current.snapshot.activeCommit,
    filters: normalizeSessionUi(current.session.config.ui),
  };
}

function totals(files: ChangedFile[]): { files: number; additions: number; deletions: number } {
  return {
    files: files.length,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

function pageValues<T>(values: T[], request: PageRequest): { cursor: number; nextCursor?: number; values: T[] } {
  const cursor = clampInteger(request.cursor, 0, values.length, 0);
  const limit = clampInteger(request.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
  const page = values.slice(cursor, cursor + limit);
  const nextCursor = cursor + page.length < values.length ? cursor + page.length : undefined;
  return { cursor, nextCursor, values: page };
}

function textPage(text: string, request: TextPageRequest): {
  startLine: number;
  endLine: number;
  totalLines: number;
  nextStartLine?: number;
  truncated: boolean;
  text: string;
} {
  const lines = text.split('\n');
  const totalLines = lines.length;
  const startLine = clampInteger(request.startLine, 1, Math.max(1, totalLines), 1);
  const maxLines = clampInteger(request.maxLines, 1, MAX_TEXT_LINES, DEFAULT_TEXT_LINES);
  const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
  const endLine = startLine + Math.max(0, selected.length - 1);
  const nextStartLine = endLine < totalLines ? endLine + 1 : undefined;
  return {
    startLine,
    endLine,
    totalLines,
    nextStartLine,
    truncated: nextStartLine !== undefined,
    text: selected.join('\n'),
  };
}

function ensureText(content: string, path: string): void {
  if (content.includes('\u0000')) throw new Error(`Binary file content is not available through MCP: ${path}`);
}

function gitOptions(settings: McpRepositorySettings): GitRunOptions {
  const megabytes = clampInteger(settings.gitMaxOutputBufferMB, 16, 4096, 256);
  const timeout = clampInteger(settings.gitCommandTimeoutMs, 0, 600_000, 0);
  return { maxBuffer: megabytes * 1024 * 1024, timeout: timeout || undefined };
}

function defaultRepositorySettings(): McpRepositorySettings {
  return {
    defaultBaseBranch: '',
    maxChangedLines: 4_000,
    gitMaxOutputBufferMB: 256,
    gitCommandTimeoutMs: 0,
  };
}

function normalizedRepositorySettings(settings: McpRepositorySettings | undefined): McpRepositorySettings {
  const defaults = defaultRepositorySettings();
  return {
    defaultBaseBranch: typeof settings?.defaultBaseBranch === 'string' ? settings.defaultBaseBranch : defaults.defaultBaseBranch,
    maxChangedLines: clampInteger(settings?.maxChangedLines, 100, 20_000, defaults.maxChangedLines),
    gitMaxOutputBufferMB: clampInteger(settings?.gitMaxOutputBufferMB, 16, 4_096, defaults.gitMaxOutputBufferMB),
    gitCommandTimeoutMs: clampInteger(settings?.gitCommandTimeoutMs, 0, 600_000, defaults.gitCommandTimeoutMs),
  };
}

function clampInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value!)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
