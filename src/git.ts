import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import {
  type ChangedFile,
  type ChangedLine,
  type ChangeSource,
  type ChangeStatus,
  type CommitAuthor,
  type CommitRecord,
  type DiffSnapshot,
  type SnapshotRequest,
} from './types';
import { loadReviewerData } from './reviewer';

const execFileAsync = promisify(execFile);
const RECORD_SEPARATOR = '\u001e';
const FIELD_SEPARATOR = '\u001f';
// Branch-wide patches can be substantially larger than Node's small default
// stdout buffer. The webview still caps line previews separately.
export const DEFAULT_GIT_MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

export interface GitRunOptions {
  maxBuffer?: number;
  timeout?: number;
}

export class GitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitError';
  }
}

export async function runGit(cwd: string, args: string[], options: GitRunOptions = {}): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: options.maxBuffer ?? DEFAULT_GIT_MAX_OUTPUT_BYTES,
      timeout: options.timeout ?? 0,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const details = error as { stderr?: string; message?: string };
    throw new GitError(details.stderr?.trim() || details.message || 'Git command failed.');
  }
}

export function authorId(name: string, email: string): string {
  return `${name}\u0000${email}`;
}

function cleanGitPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) {
    return trimmed;
  }
  try {
    // Git quotes non-ASCII paths with C-style escaping, which JSON also accepts.
    return JSON.parse(trimmed);
  } catch {
    return trimmed.slice(1, -1);
  }
}

function pathFromDiffHeader(header: string): { oldPath: string; newPath: string } {
  const match = /^diff --git a\/(.+) b\/(.+)$/m.exec(header);
  if (!match) {
    return { oldPath: 'unknown', newPath: 'unknown' };
  }
  return { oldPath: cleanGitPath(match[1]), newPath: cleanGitPath(match[2]) };
}

function statusFromPatch(patch: string): ChangeStatus {
  if (/^new file mode /m.test(patch)) return 'added';
  if (/^deleted file mode /m.test(patch)) return 'deleted';
  if (/^rename (from|to) /m.test(patch)) return 'renamed';
  return 'modified';
}

function pathFromPatch(patch: string, status: ChangeStatus): { path: string; previousPath?: string } {
  const { oldPath, newPath } = pathFromDiffHeader(patch);
  const renameTo = /^rename to (.+)$/m.exec(patch)?.[1];
  const renameFrom = /^rename from (.+)$/m.exec(patch)?.[1];
  if (status === 'renamed' && renameTo) {
    return { path: cleanGitPath(renameTo), previousPath: renameFrom ? cleanGitPath(renameFrom) : oldPath };
  }
  if (status === 'added') return { path: newPath };
  if (status === 'deleted') return { path: oldPath };
  return { path: newPath, previousPath: oldPath === newPath ? undefined : oldPath };
}

/** Parses a no-color Git patch into file and changed-line records. */
export function parsePatch(patch: string, source: ChangeSource, commitHash?: string): ChangedFile[] {
  if (!patch.trim()) return [];
  const chunks = patch
    .split(/^diff --git /m)
    .filter(Boolean)
    .map((chunk) => `diff --git ${chunk}`);

  return chunks.map((filePatch) => {
    const status = statusFromPatch(filePatch);
    const { path, previousPath } = pathFromPatch(filePatch, status);
    const lines: ChangedLine[] = [];
    let oldLine = 0;
    let newLine = 0;
    let insideHunk = false;

    for (const row of filePatch.split('\n')) {
      const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        insideHunk = true;
        continue;
      }
      if (!insideHunk || row.startsWith('\\')) continue;
      if (row.startsWith('+') && !row.startsWith('+++')) {
        lines.push({ kind: 'addition', line: newLine, text: row.slice(1) });
        newLine += 1;
      } else if (row.startsWith('-') && !row.startsWith('---')) {
        lines.push({ kind: 'deletion', line: oldLine, text: row.slice(1) });
        oldLine += 1;
      } else if (row.startsWith(' ')) {
        oldLine += 1;
        newLine += 1;
      }
    }

    return {
      path,
      previousPath,
      status,
      source,
      commitHash,
      additions: lines.filter((line) => line.kind === 'addition').length,
      deletions: lines.filter((line) => line.kind === 'deletion').length,
      lines,
      patch: filePatch,
    };
  });
}

/**
 * A file can occur in more than one commit or Git state. Keep the tree useful
 * by combining those records into the one path the user sees on disk.
 */
export function coalesceChangedFiles(files: ChangedFile[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const file of files) {
    const existing = byPath.get(file.path);
    if (!existing) {
      byPath.set(file.path, { ...file, sources: file.sources ?? [file.source], lines: [...file.lines] });
      continue;
    }
    const preferred = sourcePriority(file.source) > sourcePriority(existing.source) ? file : existing;
    const sources = [...new Set([...(existing.sources ?? [existing.source]), ...(file.sources ?? [file.source])])];
    byPath.set(file.path, {
      ...existing,
      source: preferred.source,
      sources,
      status: preferred.status,
      previousPath: preferred.previousPath ?? existing.previousPath,
      commitHash: preferred.commitHash ?? existing.commitHash,
      additions: existing.additions + file.additions,
      deletions: existing.deletions + file.deletions,
      lines: [...existing.lines, ...file.lines],
      patch: [existing.patch, file.patch].filter(Boolean).join('\n'),
    });
  }
  return [...byPath.values()];
}

/**
 * Keep only listed file paths while using the final patch from the branch base
 * to the working tree for line counts and diff content.
 */
export function applyOverallPatch(scopeFiles: ChangedFile[], overallFiles: ChangedFile[]): ChangedFile[] {
  const scoped = new Map(scopeFiles.map((file) => [file.path, file]));
  return overallFiles.flatMap((overall) => {
    const scope = scoped.get(overall.path);
    if (!scope) return [];
    return [{
      ...scope,
      previousPath: overall.previousPath ?? scope.previousPath,
      status: overall.status,
      additions: overall.additions,
      deletions: overall.deletions,
      lines: overall.lines,
      patch: overall.patch,
    }];
  });
}

/** Builds two source-only views from selected-commit patch hunks for a diff editor. */
export function authorPatchSides(patch: string): { left: string; right: string } {
  const left: string[] = [];
  const right: string[] = [];
  let insideHunk = false;
  let hunkCount = 0;

  for (const row of patch.split('\n')) {
    if (row.startsWith('diff --git ')) {
      insideHunk = false;
      continue;
    }
    if (row.startsWith('@@ ')) {
      if (hunkCount > 0) {
        left.push('');
        right.push('');
      }
      left.push(row);
      right.push(row);
      hunkCount += 1;
      insideHunk = true;
      continue;
    }
    if (!insideHunk || row.startsWith('\\')) continue;
    if (row.startsWith(' ') || !row) {
      const value = row.startsWith(' ') ? row.slice(1) : row;
      left.push(value);
      right.push(value);
    } else if (row.startsWith('-') && !row.startsWith('---')) {
      left.push(row.slice(1));
    } else if (row.startsWith('+') && !row.startsWith('+++')) {
      right.push(row.slice(1));
    }
  }

  return { left: left.join('\n'), right: right.join('\n') };
}

function sourcePriority(source: ChangeSource): number {
  return ({ author: 0, commit: 0, committed: 1, staged: 2, unstaged: 3 })[source];
}

function parseCommitRecords(output: string): CommitRecord[] {
  return output
    .split(RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', authorName = '', authorEmail = '', date = '', subject = ''] = record.split(FIELD_SEPARATOR);
      return { hash, shortHash: hash.slice(0, 8), authorName, authorEmail, date, subject };
    });
}

function collectAuthors(commits: CommitRecord[]): CommitAuthor[] {
  const byId = new Map<string, CommitAuthor>();
  for (const commit of commits) {
    const id = authorId(commit.authorName, commit.authorEmail);
    const existing = byId.get(id);
    if (existing) {
      existing.commitCount += 1;
    } else {
      byId.set(id, { id, name: commit.authorName, email: commit.authorEmail, commitCount: 1 });
    }
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export class GitRepository {
  constructor(readonly rootPath: string, private readonly options: GitRunOptions = {}) {}

  static async isRepository(path: string, options?: GitRunOptions): Promise<boolean> {
    try {
      return (await runGit(path, ['rev-parse', '--is-inside-work-tree'], options)).trim() === 'true';
    } catch {
      return false;
    }
  }

  async branch(): Promise<string> {
    const branch = (await this.run(['branch', '--show-current'])).trim();
    return branch || 'HEAD (detached)';
  }

  async root(): Promise<string> {
    return (await this.run(['rev-parse', '--show-toplevel'])).trim();
  }

  async contentAt(ref: string, path: string): Promise<string> {
    return this.run(['show', `${ref}:${path}`]);
  }

  async branches(): Promise<string[]> {
    const output = await this.run(['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
    return [...new Set(output.split('\n').map((branch) => branch.trim()).filter((branch) => branch && !branch.endsWith('/HEAD')))];
  }

  async chooseBase(configuredBase?: string): Promise<string> {
    if (configuredBase?.trim() && await this.refExists(configuredBase.trim())) return configuredBase.trim();
    try {
      const remoteHead = (await this.run(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
      if (remoteHead && await this.refExists(remoteHead)) return remoteHead;
    } catch {
      // An origin remote is optional.
    }
    for (const candidate of ['main', 'master', 'origin/main', 'origin/master']) {
      if (await this.refExists(candidate)) return candidate;
    }
    if (await this.refExists('HEAD~1')) return 'HEAD~1';
    // An unborn repository has no commits; HEAD still gives the UI a harmless
    // base value while snapshot() returns an empty state instead of throwing.
    return 'HEAD';
  }

  async refExists(ref: string): Promise<boolean> {
    try {
      await this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  }

  async snapshot(request: SnapshotRequest, configuredBase?: string, maxChangedLines = 4000): Promise<DiffSnapshot> {
    const baseBranch = request.baseBranch && await this.refExists(request.baseBranch)
      ? request.baseBranch
      : await this.chooseBase(configuredBase);
    const hasHead = await this.refExists('HEAD');
    const [branch, branches, commits, reviewer, behindBase] = await Promise.all([
      this.branch(),
      this.branches(),
      hasHead ? this.commitsSince(baseBranch) : Promise.resolve([]),
      loadReviewerData(this.rootPath),
      hasHead ? this.commitsBehind(baseBranch) : Promise.resolve(0),
    ]);
    const authors = collectAuthors(commits);
    const activeAuthorIds = request.authorIds ?? [];
    const activeAuthorKeyword = request.authorKeyword?.trim() ?? '';
    const activeCommit = request.commitHash;
    let files: ChangedFile[];
    let notice: string | undefined;

    if (!hasHead) {
      files = [];
      notice = 'This repository has no commits yet. Create a commit to compare branch changes.';
    } else if (activeCommit) {
      files = parsePatch(await this.commitPatch(activeCommit), 'commit', activeCommit);
      notice = 'Showing one commit. Git state filters do not apply in commit mode.';
    } else if (activeAuthorIds.length || activeAuthorKeyword) {
      const selected = new Set(activeAuthorIds);
      const keyword = activeAuthorKeyword.toLocaleLowerCase();
      const hashes = commits.filter((commit) => {
        const isSelected = !selected.size || selected.has(authorId(commit.authorName, commit.authorEmail));
        const keywordMatches = !keyword || `${commit.authorName} ${commit.authorEmail}`.toLocaleLowerCase().includes(keyword);
        return isSelected && keywordMatches;
      }).map((commit) => commit.hash);
      const patches = await Promise.all(hashes.map((hash) => this.commitPatch(hash)));
      files = patches.flatMap((patch, index) => parsePatch(patch, 'author', hashes[index]));
      const filterLabel = activeAuthorIds.length
        ? `the selected author${activeAuthorIds.length === 1 ? '' : 's'}`
        : `authors matching “${activeAuthorKeyword}”`;
      notice = `Showing ${hashes.length} commit${hashes.length === 1 ? '' : 's'} by ${filterLabel}. Uncommitted work is excluded because it has no commit author.`;
    } else {
      const [committed, staged, unstaged] = await Promise.all([
        this.diffPatch([`${baseBranch}...HEAD`]),
        this.diffPatch(['--cached']),
        this.diffPatch([]),
      ]);
      files = [
        ...parsePatch(committed, 'committed'),
        ...parsePatch(staged, 'staged'),
        ...parsePatch(unstaged, 'unstaged'),
      ];
    }

    files = coalesceChangedFiles(files);
    if (hasHead && !activeCommit && !activeAuthorIds.length && !activeAuthorKeyword) {
      const overallFiles = parsePatch(await this.workingTreePatch(baseBranch), 'committed');
      files = applyOverallPatch(files, overallFiles);
    }

    const totals = {
      files: new Set(files.map((file) => file.path)).size,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
    };
    const changedLineCount = files.reduce((total, file) => total + file.lines.length, 0);
    let truncated = false;
    if (changedLineCount > maxChangedLines) {
      let remaining = maxChangedLines;
      files = files.map((file) => {
        const lines = file.lines.slice(0, Math.max(0, remaining));
        remaining -= lines.length;
        return { ...file, lines };
      });
      truncated = true;
    }
    if (behindBase > 0) {
      notice = `${notice ? `${notice} ` : ''}${behindBase} commit${behindBase === 1 ? '' : 's'} from ${baseBranch} are not in the current branch.`;
    }

    return {
      repository: { path: this.rootPath, name: basename(this.rootPath), branch, branches, baseBranch },
      files,
      totals,
      commits,
      authors,
      activeAuthorIds,
      activeAuthorKeyword,
      activeCommit,
      truncated,
      behindBase,
      reviewer,
      favorites: [],
      reviewedFiles: [],
      triage: {},
      notice,
    };
  }

  private async commitsSince(baseBranch: string): Promise<CommitRecord[]> {
    const output = await this.run([
      'log', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e', '--max-count=250', `${baseBranch}..HEAD`,
    ]);
    return parseCommitRecords(output);
  }

  private async commitsBehind(baseBranch: string): Promise<number> {
    try {
      const count = await this.run(['rev-list', '--count', `HEAD..${baseBranch}`]);
      return Number(count.trim()) || 0;
    } catch {
      return 0;
    }
  }

  private diffPatch(revisionArgs: string[]): Promise<string> {
    return this.run(['diff', '--no-color', '--no-ext-diff', '--find-renames=40%', '--patch', ...revisionArgs, '--']);
  }

  private async workingTreePatch(baseBranch: string): Promise<string> {
    const mergeBase = (await this.run(['merge-base', baseBranch, 'HEAD'])).trim();
    return this.diffPatch([mergeBase]);
  }

  private commitPatch(hash: string): Promise<string> {
    return this.run(['show', '--format=', '--no-color', '--no-ext-diff', '--find-renames=40%', '--patch', hash, '--']);
  }

  private run(args: string[]): Promise<string> {
    return runGit(this.rootPath, args, this.options);
  }
}
