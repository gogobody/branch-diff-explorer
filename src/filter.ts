import type { ChangedFile, ChangedLine, ChangeSource, ChangeStatus } from './types';

export type FileScope = 'all' | Extract<ChangeSource, 'committed' | 'staged' | 'unstaged'>;
export type FileStatusFilter = 'all' | ChangeStatus;

export interface SessionUiConfig {
  query?: string;
  scope?: string;
  status?: string;
  extension?: string;
  glob?: string;
  excludeDirectories?: string;
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
}

export interface NormalizedSessionUiConfig {
  query: string;
  scope: FileScope;
  status: FileStatusFilter;
  extension: string;
  glob: string;
  excludeDirectories: string;
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
}

export const DEFAULT_SESSION_UI: NormalizedSessionUiConfig = {
  query: '',
  scope: 'all',
  status: 'all',
  extension: 'all',
  glob: '',
  excludeDirectories: '',
  caseSensitive: false,
  regex: false,
  wholeWord: false,
};

export function normalizeSessionUi(config: SessionUiConfig | undefined): NormalizedSessionUiConfig {
  const scope = ['all', 'committed', 'staged', 'unstaged'].includes(config?.scope ?? '')
    ? config!.scope as FileScope
    : 'all';
  const status = ['all', 'added', 'modified', 'deleted', 'renamed', 'unknown'].includes(config?.status ?? '')
    ? config!.status as FileStatusFilter
    : 'all';
  return {
    query: typeof config?.query === 'string' ? config.query : '',
    scope,
    status,
    extension: typeof config?.extension === 'string' && config.extension ? config.extension : 'all',
    glob: typeof config?.glob === 'string' ? config.glob : '',
    excludeDirectories: typeof config?.excludeDirectories === 'string' ? config.excludeDirectories : '',
    caseSensitive: Boolean(config?.caseSensitive),
    regex: Boolean(config?.regex),
    wholeWord: Boolean(config?.wholeWord),
  };
}

/** Returns exactly the files shown in the directory tree and available for export/MCP. */
export function visibleChangedFiles(files: ChangedFile[], config?: SessionUiConfig): ChangedFile[] {
  const normalized = normalizeSessionUi(config);
  return files.filter((file) => file.status !== 'deleted' && fileMatchesFilter(file, normalized));
}

export function visibleFileKeys(files: ChangedFile[], config?: SessionUiConfig): string[] {
  return visibleChangedFiles(files, config).map(changedFileKey);
}

/**
 * UI-friendly variant that periodically yields to the extension host while
 * filtering large snapshots. This lets the webview paint its progress state
 * instead of appearing frozen during a changed-line search.
 */
export async function visibleFileKeysAsync(files: ChangedFile[], config?: SessionUiConfig): Promise<string[]> {
  const normalized = normalizeSessionUi(config);
  const keys: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (file.status !== 'deleted' && fileMatchesFilter(file, normalized)) keys.push(changedFileKey(file));
    if ((index + 1) % 25 === 0) await yieldToExtensionHost();
  }
  return keys;
}

export function changedFileKey(file: Pick<ChangedFile, 'path' | 'source'>): string {
  return `${file.source}\u0000${file.path}`;
}

export function fileMatchesFilter(file: ChangedFile, config: NormalizedSessionUiConfig): boolean {
  // Git-state filters do not apply to author and single-commit snapshots. The
  // corresponding control is disabled in the UI, so a previously selected
  // state must not make those modes appear empty.
  if (file.source !== 'author' && file.source !== 'commit'
      && config.scope !== 'all'
      && !(file.sources ?? [file.source]).includes(config.scope)) return false;
  if (config.status !== 'all' && file.status !== config.status) return false;
  if (config.extension !== 'all' && fileExtension(file.path) !== config.extension.toLocaleLowerCase()) return false;
  if (!matchesGlob(file.path, config.glob, config.caseSensitive)) return false;
  if (matchesExcludedDirectory(file.path, config.excludeDirectories, config.caseSensitive)) return false;
  const query = splitSearchQuery(config.query);
  if (query.fileTerms.length && !query.fileTerms.every((term) => includes(file.path, term, config.caseSensitive))) return false;
  return !query.text || fullPatchHasMatchingChangedLine(file, query.text, config);
}

export function matchingChangedLines(file: ChangedFile, config?: SessionUiConfig | NormalizedSessionUiConfig): ChangedLine[] {
  const normalized = isNormalized(config) ? config : normalizeSessionUi(config);
  const query = splitSearchQuery(normalized.query).text;
  if (!query) return file.lines;
  const matcher = changedLineMatcher(query, normalized);
  if (!matcher) return [];
  return file.lines.filter((line) => matcher.test(line.text));
}

export function splitSearchQuery(query: string): { text: string; fileTerms: string[] } {
  const fileTerms: string[] = [];
  const text = query.replace(/(^|\s)file:("[^"]+"|\S+)/g, (_match, prefix: string, term: string) => {
    fileTerms.push(term.replace(/^"|"$/g, ''));
    return prefix;
  }).trim();
  return { text, fileTerms };
}

export function matchesGlob(path: string, value: string, caseSensitive = false): boolean {
  const patterns = commaTerms(value);
  const positives = patterns.filter((pattern) => !pattern.startsWith('!'));
  const negatives = patterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1));
  if (negatives.some((pattern) => globTest(path, pattern, caseSensitive))) return false;
  return !positives.length || positives.some((pattern) => globTest(path, pattern, caseSensitive));
}

export function matchesExcludedDirectory(path: string, value: string, caseSensitive = false): boolean {
  const comparedPath = caseSensitive ? path : path.toLocaleLowerCase();
  const directories = comparedPath.split('/').slice(0, -1);
  const fileName = comparedPath.split('/').pop() ?? comparedPath;
  return commaTerms(value).map((term) => term.replace(/^!/, '').replace(/^\/+|\/+$/g, '')).filter(Boolean).some((term) => {
    if (term.includes('*') || term.includes('?')) {
      return globTest(path, term, caseSensitive)
        || globTest(path, term.endsWith('/**') ? term : `${term}/**`, caseSensitive);
    }
    const comparedTerm = caseSensitive ? term : term.toLocaleLowerCase();
    if (comparedTerm.includes('/')) {
      return comparedPath === comparedTerm || comparedPath.startsWith(`${comparedTerm}/`);
    }
    return fileName === comparedTerm || directories.includes(comparedTerm);
  });
}

export function globTest(path: string, pattern: string, caseSensitive = false): boolean {
  let expression = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 2;
      } else {
        expression += '.*';
        index += 1;
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += /[|\\{}()[\]^$+?.]/.test(character) ? `\\${character}` : character;
    }
  }
  try {
    return new RegExp(`${expression}$`, caseSensitive ? '' : 'i').test(path);
  } catch {
    return false;
  }
}

function fileExtension(path: string): string {
  return (/\.[^/.]+$/.exec(path)?.[0] ?? '(no extension)').toLocaleLowerCase();
}

function commaTerms(value: string): string[] {
  return value.split(',').map((term) => term.trim()).filter(Boolean);
}

function includes(value: string, search: string, caseSensitive: boolean): boolean {
  return caseSensitive ? value.includes(search) : value.toLocaleLowerCase().includes(search.toLocaleLowerCase());
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fullPatchHasMatchingChangedLine(
  file: ChangedFile,
  query: string,
  config: NormalizedSessionUiConfig,
): boolean {
  const matcher = changedLineMatcher(query, config);
  if (!matcher) return false;
  if (!file.patch) return file.lines.some((line) => matcher.test(line.text));

  // Search only unified-diff hunk additions/deletions. Patch headers such as
  // +++ b/file.c must not produce a match, while a real changed source line
  // whose content starts with "++" still must be searchable.
  let inHunk = false;
  for (const line of file.patch.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (inHunk && (line.startsWith('+') || line.startsWith('-')) && matcher.test(line.slice(1))) return true;
  }
  return false;
}

function changedLineMatcher(query: string, config: NormalizedSessionUiConfig): RegExp | undefined {
  try {
    const expression = config.regex ? query : escapeRegex(query);
    return new RegExp(config.wholeWord ? `\\b(?:${expression})\\b` : expression, config.caseSensitive ? '' : 'i');
  } catch {
    return undefined;
  }
}

function yieldToExtensionHost(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function isNormalized(config: SessionUiConfig | NormalizedSessionUiConfig | undefined): config is NormalizedSessionUiConfig {
  return Boolean(config
    && typeof config.query === 'string'
    && typeof config.scope === 'string'
    && typeof config.status === 'string'
    && typeof config.extension === 'string'
    && typeof config.glob === 'string'
    && typeof config.excludeDirectories === 'string');
}
