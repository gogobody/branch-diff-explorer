import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { applyOverallLineTotals, applyOverallPatch, authorId, coalesceChangedFiles, DEFAULT_GIT_MAX_OUTPUT_BYTES, GitRepository, parsePatch, revertPatchFromContent, revertPatchWithDiagnostics, runGit } from '../src/git';

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

describe('coalesceChangedFiles', () => {
  it('shows a changed path once while retaining its Git states and line totals', () => {
    const committed = parsePatch(`diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdef0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+committed
`, 'committed')[0];
    const unstaged = parsePatch(`diff --git a/src/example.ts b/src/example.ts
index abcdef0..fedcba0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-committed
+working-tree
`, 'unstaged')[0];

    expect(coalesceChangedFiles([committed, unstaged])).toMatchObject([{
      path: 'src/example.ts',
      source: 'unstaged',
      sources: ['committed', 'unstaged'],
      additions: 2,
      deletions: 2,
    }]);
  });
});

describe('applyOverallPatch', () => {
  it('uses final file line totals instead of adding intermediate changes', () => {
    const scope = parsePatch(`diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdef0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+first
`, 'author');
    const overall = parsePatch(`diff --git a/src/example.ts b/src/example.ts
index 1234567..fedcba0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1 +1 @@
-old
+final
`, 'committed');

    expect(applyOverallPatch(scope, overall)).toMatchObject([{
      path: 'src/example.ts',
      source: 'author',
      additions: 1,
      deletions: 1,
      lines: [{ kind: 'deletion', line: 1, text: 'old' }, { kind: 'addition', line: 1, text: 'final' }],
    }]);
  });

  it('keeps an earlier author edit visible after the file is renamed later', () => {
    const scope = parsePatch(`diff --git a/src/old.ts b/src/old.ts
index 1234567..abcdef0 100644
--- a/src/old.ts
+++ b/src/old.ts
@@ -1 +1 @@
-before
+after
`, 'author');
    const overall = parsePatch(`diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`, 'committed');

    expect(applyOverallPatch(scope, overall)).toMatchObject([{
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
      patch: expect.stringContaining('rename to src/new.ts'),
    }]);
  });
});

describe('revertPatchFromContent', () => {
  it('keeps non-author content while reverting only the selected author patch', () => {
    const left = revertPatchFromContent(`const untouched = 'alice';
const value = 'after';
const trailing = 'alice';
`, `diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdef0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,2 +1,2 @@
 const untouched = 'alice';
-const value = 'before';
+const value = 'after';
 const trailing = 'alice';
`);

    expect(left).toContain("const value = 'before';");
    expect(left).toContain("const untouched = 'alice';");
    expect(left).toContain("const trailing = 'alice';");
    expect(left).not.toContain("const value = 'after';");
  });

  it('still reverses an author edit when another author changed its hunk context', () => {
    const left = revertPatchFromContent(`const heading = 'changed by another author';
const value = 'after';
const footer = 'stable';
`, `diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdef0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 const heading = 'base';
-const value = 'before';
+const value = 'after';
 const footer = 'stable';
`);

    expect(left).toBe(`const heading = 'changed by another author';
const value = 'before';
const footer = 'stable';
`);
  });

  it('restores an author deletion using unchanged nearby context', () => {
    const left = revertPatchFromContent(`const heading = 'changed by another author';
const footer = 'stable';
`, `diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdef0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,2 @@
 const heading = 'base';
-const removedByAuthor = true;
 const footer = 'stable';
`);

    expect(left).toBe(`const heading = 'changed by another author';
const removedByAuthor = true;
const footer = 'stable';
`);
  });

  it('keeps later non-author lines unhighlighted in files created by an author', () => {
    const left = revertPatchFromContent(`export const authorLine = true;
export const sharedLine = 'initial';
export const laterAuthorLine = 'bob';
`, `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const authorLine = true;
+export const sharedLine = 'initial';
`);

    expect(left).toBe("export const laterAuthorLine = 'bob';\n");
  });

  it('keeps a later non-author insertion when it splits selected author additions', () => {
    const left = revertPatchFromContent(`export const firstAuthorLine = true;
export const insertedByBob = true;
export const secondAuthorLine = true;
`, `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const firstAuthorLine = true;
+export const secondAuthorLine = true;
`);

    expect(left).toBe('export const insertedByBob = true;\n');
  });

  it('recovers surviving author lines from a mixed block split by another author', () => {
    const result = revertPatchWithDiagnostics(`static int heading = 1;
new_one();
bob_inserted();
new_two();
static int footer = 0;
`, `diff --git a/example.c b/example.c
index 1234567..abcdef0 100644
--- a/example.c
+++ b/example.c
@@ -1,4 +1,4 @@
 static int heading = 0;
-old_one();
-old_two();
+new_one();
+new_two();
 static int footer = 0;
`);

    expect(result).toEqual({
      content: `static int heading = 1;
old_one();
old_two();
bob_inserted();
static int footer = 0;
`,
      unmatchedBlocks: 0,
    });
  });

  it('reports edits that were overwritten and cannot be highlighted safely', () => {
    const result = revertPatchWithDiagnostics(`const heading = 'changed by another author';
const value = 'replaced by another author';
const footer = 'changed by another author';
`, `diff --git a/src/example.ts b/src/example.ts
index 1234567..abcdef0 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,3 +1,3 @@
 const heading = 'base';
-const value = 'before';
+const value = 'after';
 const footer = 'stable';
`);

    expect(result).toEqual({
      content: `const heading = 'changed by another author';
const value = 'replaced by another author';
const footer = 'changed by another author';
`,
      unmatchedBlocks: 1,
    });
  });
});

describe('applyOverallLineTotals', () => {
  it('uses branch diff totals without replacing the author-only patch', () => {
    const authorFiles = parsePatch(`diff --git a/example.ts b/example.ts
@@ -1 +1 @@
-before
+after
`, 'author');
    const branchFiles = parsePatch(`diff --git a/example.ts b/example.ts
@@ -1,3 +1,2 @@
-one
-two
+updated
 three
`, 'committed');
    const result = applyOverallLineTotals(authorFiles, branchFiles);
    expect(result).toMatchObject([{ source: 'author', additions: 1, deletions: 2 }]);
    expect(result[0].patch).toContain('+after');
  });

  it('uses the final renamed path while retaining the author-only patch', () => {
    const authorFiles = parsePatch(`diff --git a/src/old.ts b/src/old.ts
@@ -1 +1 @@
-before
+after
`, 'author');
    const branchFiles = parsePatch(`diff --git a/src/old.ts b/src/new.ts
similarity index 100%
rename from src/old.ts
rename to src/new.ts
`, 'committed');

    expect(applyOverallLineTotals(authorFiles, branchFiles)).toMatchObject([{
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
      patch: expect.stringContaining('+after'),
    }]);
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
    await writeFile(join(repositoryPath, 'src', 'bob.ts'), 'export const bob = "updated";\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'Bob updates the same file']);
    const bobUpdateHash = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(repositoryPath, 'readme.md'), '# Base\nBob first\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'Bob edits an existing file']);
    await writeFile(join(repositoryPath, 'readme.md'), '# Base\nBob final\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'Bob updates the existing file']);
    await runGit(repositoryPath, ['config', 'user.name', 'Alice']);
    await runGit(repositoryPath, ['config', 'user.email', 'alice@example.test']);
    await writeFile(join(repositoryPath, 'src', 'bob.ts'), 'export const bob = "updated";\nexport const aliceFollowUp = true;\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'Alice changes Bob file']);
    await writeFile(join(repositoryPath, 'uncommitted.ts'), 'export const uncommitted = true;\n');

    const repository = new GitRepository(repositoryPath);
    const allChanges = await repository.snapshot({ baseBranch: 'main' });
    expect(allChanges.files.map((file) => file.path)).toEqual(expect.arrayContaining(['src/alice.ts', 'src/bob.ts']));
    expect(allChanges.totals).toMatchObject({ files: 3, additions: 4, deletions: 0 });
    expect(allChanges.files.find((file) => file.path === 'src/bob.ts')).toMatchObject({ additions: 2, deletions: 0 });

    const bobChanges = await repository.snapshot({
      baseBranch: 'main',
      authorIds: [authorId('Bob', 'bob@example.test')],
    });
    expect(bobChanges.files).toHaveLength(2);
    expect(bobChanges.files.find((file) => file.path === 'src/bob.ts')).toMatchObject({ source: 'author', sources: ['author'], commitHash: bobUpdateHash, additions: 2, deletions: 0 });
    expect(bobChanges.files.find((file) => file.path === 'readme.md')).toMatchObject({ source: 'author', additions: 1, deletions: 0 });
    expect(bobChanges.files.find((file) => file.path === 'src/bob.ts')?.patch).not.toContain('aliceFollowUp');
    expect(bobChanges.notice).toContain('Uncommitted work is excluded');

    const keywordChanges = await repository.snapshot({ baseBranch: 'main', authorKeyword: 'bob@example' });
    expect(keywordChanges.files).toHaveLength(2);
    expect(keywordChanges.files.find((file) => file.path === 'src/bob.ts')).toMatchObject({ source: 'author' });
    expect(keywordChanges.activeAuthorKeyword).toBe('bob@example');
  });

  it('keeps a selected author path after a later rename by another author', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-explorer-rename-'));
    temporaryDirectories.push(repositoryPath);
    await runGit(repositoryPath, ['init', '--initial-branch=main']);
    await runGit(repositoryPath, ['config', 'user.name', 'Alice']);
    await runGit(repositoryPath, ['config', 'user.email', 'alice@example.test']);
    await mkdir(join(repositoryPath, 'src'));
    await writeFile(join(repositoryPath, 'src', 'old.ts'), 'one\ntwo\nthree\nfour\nfive\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'base']);
    await runGit(repositoryPath, ['checkout', '-b', 'feature']);
    await writeFile(join(repositoryPath, 'src', 'old.ts'), 'one\ntwo updated\nthree\nfour\nfive\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'Alice updates the file']);
    await runGit(repositoryPath, ['config', 'user.name', 'Bob']);
    await runGit(repositoryPath, ['config', 'user.email', 'bob@example.test']);
    await runGit(repositoryPath, ['mv', 'src/old.ts', 'src/new.ts']);
    await runGit(repositoryPath, ['commit', '-m', 'Bob renames the file']);

    const snapshot = await new GitRepository(repositoryPath).snapshot({
      baseBranch: 'main',
      authorIds: [authorId('Alice', 'alice@example.test')],
    });

    expect(snapshot.files).toMatchObject([{
      path: 'src/new.ts',
      previousPath: 'src/old.ts',
      source: 'author',
      status: 'renamed',
    }]);
    expect(snapshot.files[0].patch).toContain('two updated');
  });

  it('includes matching author commits older than the previous 250-commit cutoff', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-explorer-long-history-'));
    temporaryDirectories.push(repositoryPath);
    await runGit(repositoryPath, ['init', '--initial-branch=main']);
    await runGit(repositoryPath, ['config', 'user.name', 'Alice']);
    await runGit(repositoryPath, ['config', 'user.email', 'alice@example.test']);
    await writeFile(join(repositoryPath, 'example.c'), 'base\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'base']);
    await runGit(repositoryPath, ['checkout', '-b', 'feature']);
    await writeFile(join(repositoryPath, 'example.c'), 'base\nold author line\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'old Alice change']);

    await runGit(repositoryPath, ['config', 'user.name', 'Bob']);
    await runGit(repositoryPath, ['config', 'user.email', 'bob@example.test']);
    for (let index = 0; index < 250; index += 1) {
      await runGit(repositoryPath, ['commit', '--allow-empty', '-m', `Bob filler ${index}`]);
    }

    await runGit(repositoryPath, ['config', 'user.name', 'Alice']);
    await runGit(repositoryPath, ['config', 'user.email', 'alice@example.test']);
    await writeFile(join(repositoryPath, 'example.c'), 'base\nold author line\nrecent author line\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'recent Alice change']);

    const snapshot = await new GitRepository(repositoryPath).snapshot({
      baseBranch: 'main',
      authorKeyword: 'alice@example',
    });
    const file = snapshot.files.find((candidate) => candidate.path === 'example.c');
    expect(snapshot.notice).toContain('Showing 2 commits');
    expect(file).toMatchObject({ additions: 2, deletions: 0 });
    expect(file?.patch).toContain('+old author line');
    expect(file?.patch).toContain('+recent author line');
  }, 30000);
});

describe('GitRepository comparison base', () => {
  it('uses the merge base when both branches create the same path after diverging', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-explorer-merge-base-'));
    temporaryDirectories.push(repositoryPath);
    await runGit(repositoryPath, ['init', '--initial-branch=main']);
    await runGit(repositoryPath, ['config', 'user.name', 'Alice']);
    await runGit(repositoryPath, ['config', 'user.email', 'alice@example.test']);
    await writeFile(join(repositoryPath, 'readme.md'), 'base\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'base']);
    const divergence = (await runGit(repositoryPath, ['rev-parse', 'HEAD'])).trim();

    await runGit(repositoryPath, ['checkout', '-b', 'feature']);
    await writeFile(join(repositoryPath, 'shared.ts'), 'export const value = "feature";\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'feature creates shared path']);

    await runGit(repositoryPath, ['checkout', 'main']);
    await writeFile(join(repositoryPath, 'shared.ts'), 'export const value = "main";\n');
    await runGit(repositoryPath, ['add', '.']);
    await runGit(repositoryPath, ['commit', '-m', 'main creates shared path']);
    await runGit(repositoryPath, ['checkout', 'feature']);

    const repository = new GitRepository(repositoryPath);
    const snapshot = await repository.snapshot({ baseBranch: 'main' });
    expect(snapshot.files).toMatchObject([{
      path: 'shared.ts',
      status: 'added',
      additions: 1,
      deletions: 0,
    }]);
    expect(await repository.comparisonBase('main')).toBe(divergence);
    await expect(repository.contentAt(divergence, 'shared.ts')).rejects.toThrow();
    expect(await repository.contentAt('main', 'shared.ts')).toContain('main');
  });
});
