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
  return overallFiles.flatMap((overall) => {
    const scope = matchingScopedFile(scopeFiles, overall);
    if (!scope) return [];
    return [{
      ...scope,
      path: overall.path,
      previousPath: overall.previousPath ?? scope.previousPath,
      status: overall.status,
      additions: overall.additions,
      deletions: overall.deletions,
      lines: overall.lines,
      patch: overall.patch,
    }];
  });
}

/** Keeps author-specific patch data while replacing only tree statistics with the branch diff. */
export function applyOverallLineTotals(scopeFiles: ChangedFile[], overallFiles: ChangedFile[]): ChangedFile[] {
  return overallFiles.flatMap((overall) => {
    const scope = matchingScopedFile(scopeFiles, overall);
    if (!scope) return [];
    return [{
      ...scope,
      path: overall.path,
      previousPath: overall.previousPath ?? scope.previousPath,
      status: overall.status,
      additions: overall.additions,
      deletions: overall.deletions,
    }];
  });
}

/**
 * Git reports a final rename with both its old and new path. Match either one
 * so an author's earlier edit remains visible after somebody renames the file.
 */
function matchingScopedFile(scopeFiles: ChangedFile[], overall: ChangedFile): ChangedFile | undefined {
  const finalPaths = new Set([overall.path, overall.previousPath].filter((path): path is string => Boolean(path)));
  return scopeFiles.find((file) => [file.path, file.previousPath].some((path) => path !== undefined && finalPaths.has(path)));
}

interface PatchHunk {
  newStart: number;
  oldLines: string[];
  newLines: string[];
  entries: PatchEntry[];
}

interface PatchEntry {
  kind: 'context' | 'deletion' | 'addition';
  text: string;
}

interface PatchEditBlock {
  newStart: number;
  oldLines: string[];
  newLines: string[];
  beforeContext: string[];
  afterContext: string[];
}

/**
 * Reverts selected commits from a full file, leaving all non-selected changes
 * identical on both sides of a side-by-side author-filtered diff.
 */
export function revertPatchFromContent(content: string, patch: string): string {
  return revertPatchWithDiagnostics(content, patch).content;
}

export interface PatchRevertResult {
  content: string;
  /** Edits that no longer occur in the current file, so they cannot be highlighted safely. */
  unmatchedBlocks: number;
}

/**
 * Produces the left side of an author-filtered diff and reports author edits
 * that were overwritten or moved so far that no safe inverse can be found.
 */
export function revertPatchWithDiagnostics(content: string, patch: string): PatchRevertResult {
  const lines = content.split('\n');
  const usesCarriageReturns = lines.some((line) => line.endsWith('\r'));
  let unmatchedBlocks = 0;
  const chunks = patch.split(/^diff --git /m).filter(Boolean).map((chunk) => `diff --git ${chunk}`);
  for (const chunk of chunks) {
    const hunks = patchHunks(chunk);
    for (const hunk of hunks.reverse()) {
      if (revertExactHunk(lines, hunk, usesCarriageReturns)) continue;
      // A later commit often changes only the hunk's context. Revert each
      // actual author edit using nearby context as a soft anchor instead of
      // silently losing the highlight when that context no longer matches.
      for (const block of patchEditBlocks(hunk).reverse()) {
        if (!revertFuzzyBlock(lines, block, usesCarriageReturns).complete) unmatchedBlocks += 1;
      }
    }
  }
  return { content: lines.join('\n'), unmatchedBlocks };
}

function revertExactHunk(lines: string[], hunk: PatchHunk, usesCarriageReturns: boolean): boolean {
  const index = findLineSequence(lines, hunk.newLines, hunk.newStart - 1);
  if (index === undefined) return false;
  lines.splice(index, hunk.newLines.length, ...withLineEnding(hunk.oldLines, usesCarriageReturns));
  return true;
}

interface RevertBlockResult {
  complete: boolean;
}

function revertFuzzyBlock(lines: string[], block: PatchEditBlock, usesCarriageReturns: boolean): RevertBlockResult {
  const index = findFuzzyPlacement(lines, block);
  if (index !== undefined) {
    lines.splice(index, block.newLines.length, ...withLineEnding(block.oldLines, usesCarriageReturns));
    return { complete: true };
  }
  // A selected author can create several adjacent lines and another author
  // can later insert between them. Treat those additions independently so
  // the surviving selected lines still receive their diff highlight.
  if (!block.oldLines.length && block.newLines.length > 1) {
    const positions = separatedAdditionPositions(lines, block);
    for (const position of [...positions].reverse()) lines.splice(position, 1);
    return { complete: positions.length === block.newLines.length };
  }
  return { complete: false };
}

function patchEditBlocks(hunk: PatchHunk): PatchEditBlock[] {
  const blocks: PatchEditBlock[] = [];
  const context: string[] = [];
  let newOffset = 0;
  let active: PatchEditBlock | undefined;

  for (let index = 0; index < hunk.entries.length; index += 1) {
    const entry = hunk.entries[index];
    if (entry.kind === 'context') {
      if (active) {
        active.afterContext = contiguousContextAfter(hunk.entries, index);
        blocks.push(active);
        active = undefined;
      }
      context.push(entry.text);
      newOffset += 1;
      continue;
    }
    if (!active) {
      active = {
        newStart: hunk.newStart + newOffset,
        oldLines: [],
        newLines: [],
        beforeContext: context.slice(-3),
        afterContext: [],
      };
    }
    if (entry.kind === 'deletion') {
      active.oldLines.push(entry.text);
    } else {
      active.newLines.push(entry.text);
      newOffset += 1;
    }
  }
  if (active) blocks.push(active);
  return blocks;
}

function contiguousContextAfter(entries: PatchEntry[], start: number): string[] {
  const result: string[] = [];
  for (let index = start; index < entries.length && result.length < 3; index += 1) {
    const entry = entries[index];
    if (entry.kind !== 'context') break;
    result.push(entry.text);
  }
  return result;
}

function findFuzzyPlacement(lines: string[], block: PatchEditBlock): number | undefined {
  const preferredIndex = block.newStart - 1;
  const candidates = block.newLines.length
    ? sequencePositions(lines, block.newLines)
    : anchorPositions(lines, block.beforeContext, block.afterContext);
  if (!candidates.length) return undefined;
  let result: number | undefined;
  let score = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateScore = fuzzyPlacementScore(lines, candidate, block);
    if (candidateScore > score) {
      result = candidate;
      score = candidateScore;
    }
  }
  return result;
}

function separatedAdditionPositions(lines: string[], block: PatchEditBlock): number[] {
  const positions: number[] = [];
  let minimumIndex = 0;
  for (let offset = 0; offset < block.newLines.length; offset += 1) {
    const individual: PatchEditBlock = {
      ...block,
      newStart: block.newStart + offset,
      newLines: [block.newLines[offset]],
      beforeContext: offset === 0 ? block.beforeContext : [],
      afterContext: offset === block.newLines.length - 1 ? block.afterContext : [],
    };
    const candidates = sequencePositions(lines, individual.newLines).filter((index) => index >= minimumIndex);
    if (!candidates.length) continue;
    const position = candidates.reduce((best, candidate) => {
      return fuzzyPlacementScore(lines, candidate, individual) > fuzzyPlacementScore(lines, best, individual)
        ? candidate
        : best;
    });
    positions.push(position);
    minimumIndex = position + 1;
  }
  return positions;
}

function fuzzyPlacementScore(lines: string[], candidate: number, block: PatchEditBlock): number {
  const beforeMatches = contextBeforeMatches(lines, candidate, block.beforeContext);
  const afterMatches = contextAfterMatches(lines, candidate + block.newLines.length, block.afterContext);
  // A matching changed sequence is the main signal; exact adjacent context
  // resolves repeated snippets and offsets introduced by other commits.
  return beforeMatches * 1000 + afterMatches * 1000 - Math.abs(candidate - (block.newStart - 1));
}

function anchorPositions(lines: string[], before: string[], after: string[]): number[] {
  const positions = new Set<number>();
  for (const index of sequencePositions(lines, before)) positions.add(index + before.length);
  for (const index of sequencePositions(lines, after)) positions.add(index);
  return [...positions];
}

function contextBeforeMatches(lines: string[], index: number, context: string[]): number {
  let matched = 0;
  for (let offset = 1; offset <= context.length && index - offset >= 0; offset += 1) {
    if (!sameLine(lines[index - offset], context[context.length - offset])) break;
    matched += 1;
  }
  return matched;
}

function contextAfterMatches(lines: string[], index: number, context: string[]): number {
  let matched = 0;
  for (let offset = 0; offset < context.length && index + offset < lines.length; offset += 1) {
    if (!sameLine(lines[index + offset], context[offset])) break;
    matched += 1;
  }
  return matched;
}

function withLineEnding(lines: string[], usesCarriageReturns: boolean): string[] {
  return usesCarriageReturns ? lines.map((line) => line.endsWith('\r') ? line : `${line}\r`) : lines;
}

function patchHunks(patch: string): PatchHunk[] {
  const hunks: PatchHunk[] = [];
  let current: PatchHunk | undefined;
  for (const row of patch.split('\n')) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (header) {
      current = { newStart: Number(header[1]), oldLines: [], newLines: [], entries: [] };
      hunks.push(current);
      continue;
    }
    if (!current || row.startsWith('\\')) continue;
    if (row.startsWith(' ')) {
      const text = row.slice(1);
      current.oldLines.push(text);
      current.newLines.push(text);
      current.entries.push({ kind: 'context', text });
    } else if (row.startsWith('-') && !row.startsWith('---')) {
      const text = row.slice(1);
      current.oldLines.push(text);
      current.entries.push({ kind: 'deletion', text });
    } else if (row.startsWith('+') && !row.startsWith('+++')) {
      const text = row.slice(1);
      current.newLines.push(text);
      current.entries.push({ kind: 'addition', text });
    }
  }
  return hunks;
}

function findLineSequence(lines: string[], expected: string[], preferredIndex: number): number | undefined {
  if (!expected.length) return Math.max(0, Math.min(preferredIndex, lines.length));
  const positions = sequencePositions(lines, expected);
  return positions.sort((left, right) => Math.abs(left - preferredIndex) - Math.abs(right - preferredIndex))[0];
}

function sequencePositions(lines: string[], expected: string[]): number[] {
  if (!expected.length) return [];
  const positions: number[] = [];
  for (let index = 0; index <= lines.length - expected.length; index += 1) {
    if (expected.every((line, offset) => sameLine(lines[index + offset], line))) positions.push(index);
  }
  return positions;
}

function sameLine(left: string, right: string): boolean {
  return left === right || left.replace(/\r$/, '') === right.replace(/\r$/, '');
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

  /** The common ancestor used by Git's three-dot branch comparison. */
  async comparisonBase(baseBranch: string): Promise<string> {
    return (await this.run(['merge-base', baseBranch, 'HEAD'])).trim();
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
    if (hasHead && !activeCommit) {
      const overallFiles = parsePatch(await this.workingTreePatch(baseBranch), 'committed');
      files = activeAuthorIds.length || activeAuthorKeyword
        ? applyOverallLineTotals(files, overallFiles)
        : applyOverallPatch(files, overallFiles);
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
    const mergeBase = await this.comparisonBase(baseBranch);
    return this.diffPatch([mergeBase]);
  }

  private commitPatch(hash: string): Promise<string> {
    return this.run(['show', '--format=', '--no-color', '--no-ext-diff', '--find-renames=40%', '--patch', hash, '--']);
  }

  private run(args: string[]): Promise<string> {
    return runGit(this.rootPath, args, this.options);
  }
}
