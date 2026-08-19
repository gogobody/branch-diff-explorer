import { describe, expect, it } from 'vitest';
import { diffExportContent, diffExportRelativePath } from '../src/export';

describe('filtered diff export', () => {
  it('preserves the repository directory structure and appends .diff', () => {
    expect(diffExportRelativePath('source/services/example.c')).toBe('source/services/example.c.diff');
    expect(diffExportRelativePath('README.md')).toBe('README.md.diff');
  });

  it('rejects paths that can escape the selected export directory', () => {
    expect(diffExportRelativePath('../outside.c')).toBeUndefined();
    expect(diffExportRelativePath('/absolute.c')).toBeUndefined();
    expect(diffExportRelativePath('source//example.c')).toBeUndefined();
  });

  it('keeps unified diff markers and ends exported files with a newline', () => {
    const patch = 'diff --git a/example.c b/example.c\n--- a/example.c\n+++ b/example.c\n@@ -1 +1 @@\n-old\n+new';
    expect(diffExportContent(patch)).toBe(`${patch}\n`);
  });
});
