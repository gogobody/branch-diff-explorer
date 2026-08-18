import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { authorId, DEFAULT_GIT_MAX_OUTPUT_BYTES, GitRepository, parsePatch, runGit } from '../src/git';

const temporaryDirectories: string[] = [];

afterAll(() => {
  // The operating system clears /tmp; directories are intentionally left for failed-test inspection.
});

describe('parsePatch', () => {
  it('keeps precise old and new line numbers for additions and deletions', () => {
    const files = parsePatch(`diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdef0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -8,3 +8,4 @@ export function demo() {
-  return 'old';
+  const value = 'new';
+  return value;
 }
`, 'committed');

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'src/example.ts', status: 'modified', additions: 2, deletions: 1 });
    expect(files[0].lines).toEqual([
      { kind: 'deletion', line: 8, text: "  return 'old';" },
      { kind: 'addition', line: 8, text: "  const value = 'new';" },
      { kind: 'addition', line: 9, text: '  return value;' },
    ]);
  });

  it('recognizes new, deleted, and renamed paths', () => {
    const patch = `diff --git a/new.ts b/new.ts
new file mode 100644
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+created
diff --git a/old.ts b/old.ts
deleted file mode 100644
--- a/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-deleted
diff --git a/from.ts b/to.ts
similarity index 100%
rename from from.ts
rename to to.ts
`;
    expect(parsePatch(patch, 'committed').map((file) => [file.status, file.path, file.previousPath])).toEqual([
      ['added', 'new.ts', undefined],
      ['deleted', 'old.ts', undefined],
      ['renamed', 'to.ts', 'from.ts'],
    ]);
  });
});

describe('Git output options', () => {
  it('keeps a large default buffer and accepts an override', async () => {
    expect(DEFAULT_GIT_MAX_OUTPUT_BYTES).toBe(256 * 1024 * 1024);
    const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-explorer-options-'));
    temporaryDirectories.push(repositoryPath);
    await runGit(repositoryPath, ['init', '--initial-branch=main'], { maxBuffer: 16 * 1024 * 1024, timeout: 10000 });
    expect(await new GitRepository(repositoryPath, { maxBuffer: 16 * 1024 * 1024, timeout: 10000 }).branch()).toBe('main');
  });
});

describe('GitRepository author filtering', () => {
  it('returns an empty, usable snapshot for a repository without commits', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-explorer-empty-'));
    temporaryDirectories.push(repositoryPath);
    await runGit(repositoryPath, ['init', '--initial-branch=main']);

    const snapshot = await new GitRepository(repositoryPath).snapshot({});

    expect(snapshot.files).toEqual([]);
    expect(snapshot.commits).toEqual([]);
    expect(snapshot.notice).toContain('no commits yet');
  });

  it('returns only patches created by selected commit authors and excludes working-tree changes', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-explorer-'));
    temporaryDirectories.push(repositoryPath);
    await runGit(repositoryPath, ['init', '--initial-branch=main']);
    await runGit(repositoryPath, ['config', 'user.name', 'Alice']);
    await runGit(repositoryPath, ['config', 'user.email', 'alice@example.test']);
    await writeFile(join(repositoryPath, 'readme.md'), '# Base\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'base']);
    await runGit(repositoryPath, ['checkout', '-b', 'feature']);

    await mkdir(join(repositoryPath, 'src'));
    await writeFile(join(repositoryPath, 'src', 'alice.ts'), 'export const alice = true;\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'Alice adds a file']);

    await runGit(repositoryPath, ['config', 'user.name', 'Bob']);
    await runGit(repositoryPath, ['config', 'user.email', 'bob@example.test']);
    await writeFile(join(repositoryPath, 'src', 'bob.ts'), 'export const bob = true;\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'Bob adds a file']);
    await writeFile(join(repositoryPath, 'uncommitted.ts'), 'export const uncommitted = true;\n');

    const repository = new GitRepository(repositoryPath);
    const allChanges = await repository.snapshot({ baseBranch: 'main' });
    expect(allChanges.files.map((file) => file.path)).toEqual(expect.arrayContaining(['src/alice.ts', 'src/bob.ts']));
    expect(allChanges.totals).toMatchObject({ files: 2, additions: 2, deletions: 0 });

    const bobChanges = await repository.snapshot({
      baseBranch: 'main',
      authorIds: [authorId('Bob', 'bob@example.test')],
    });
    expect(bobChanges.files).toHaveLength(1);
    expect(bobChanges.files[0]).toMatchObject({ path: 'src/bob.ts', source: 'author', status: 'added' });
    expect(bobChanges.notice).toContain('Uncommitted work is excluded');

    const keywordChanges = await repository.snapshot({ baseBranch: 'main', authorKeyword: 'bob@example' });
    expect(keywordChanges.files).toHaveLength(1);
    expect(keywordChanges.files[0]).toMatchObject({ path: 'src/bob.ts', source: 'author' });
    expect(keywordChanges.activeAuthorKeyword).toBe('bob@example');
  });
});
