import { describe, expect, it } from 'vitest';
import { changedFileKey, matchingChangedLines, visibleChangedFiles } from '../src/filter';
import type { ChangedFile } from '../src/types';

function file(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    status: 'modified',
    source: 'committed',
    additions: 1,
    deletions: 0,
    lines: [{ kind: 'addition', line: 1, text: 'const selected = true;' }],
    patch: '',
    ...overrides,
  };
}

describe('shared file filtering', () => {
  it('applies exclude, glob, file-term, extension, and changed-line filters together', () => {
    const files = [
      file('src/selected.ts'),
      file('src/generated/selected.ts'),
      file('src/selected.js'),
      file('src/other.ts', { lines: [{ kind: 'addition', line: 1, text: 'const other = true;' }] }),
    ];
    const result = visibleChangedFiles(files, {
      query: 'selected file:src',
      extension: '.ts',
      glob: 'src/**',
      excludeDirectories: 'generated',
    });
    expect(result.map((item) => item.path)).toEqual(['src/selected.ts']);
    expect(changedFileKey(result[0])).toBe('committed\u0000src/selected.ts');
  });

  it('keeps deleted files out and ignores a stale Git-state filter in author mode', () => {
    const result = visibleChangedFiles([
      file('src/author.ts', { source: 'author' }),
      file('src/deleted.ts', { source: 'author', status: 'deleted' }),
    ], { scope: 'staged' });
    expect(result.map((item) => item.path)).toEqual(['src/author.ts']);
  });

  it('supports regex, whole-word, and case-sensitive matching without throwing on invalid expressions', () => {
    const changed = file('src/example.ts', {
      lines: [
        { kind: 'addition', line: 3, text: 'RouteStats routeStats;' },
        { kind: 'addition', line: 4, text: 'RouteStatistics other;' },
      ],
    });
    expect(matchingChangedLines(changed, { query: 'RouteStats', regex: true, wholeWord: true, caseSensitive: true })).toHaveLength(1);
    expect(visibleChangedFiles([changed], { query: '[', regex: true })).toEqual([]);
  });
});
