import { describe, expect, it } from 'vitest';
import { changedFileKey, matchingChangedLines, visibleChangedFiles, visibleFileKeysAsync } from '../src/filter';
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

  it('searches the complete patch when the changed-line preview was truncated', async () => {
    const changed = file('source/services/spdk/module/bdev/glfs/bdev_glfs.c', {
      lines: [{ kind: 'addition', line: 1, text: 'an earlier preview line' }],
      patch: [
        'diff --git a/source.c b/source.c',
        '--- a/source.c',
        '+++ b/source.c',
        '@@ -4643,0 +4644,3 @@',
        '+void glfs_bdev_get_route_stats(void)',
        '+{',
        '+}',
      ].join('\n'),
    });

    expect(visibleChangedFiles([changed], { query: 'glfs_bdev_get_route_stats' })).toEqual([changed]);
    expect(await visibleFileKeysAsync([changed], { query: 'glfs_bdev_get_route_stats' }))
      .toEqual(['committed\u0000source/services/spdk/module/bdev/glfs/bdev_glfs.c']);
    expect(matchingChangedLines(changed, { query: 'glfs_bdev_get_route_stats' })).toEqual([]);
  });

  it('does not treat unified-diff file headers as changed-line search results', () => {
    const changed = file('src/header-only.ts', {
      lines: [],
      patch: ['diff --git a/src/header-only.ts b/src/header-only.ts', '--- a/src/header-only.ts', '+++ b/src/header-only.ts'].join('\n'),
    });
    expect(visibleChangedFiles([changed], { query: 'header-only.ts' })).toEqual([]);
  });
});
