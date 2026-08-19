import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { BranchDiffMcpService } from '../src/mcp-service';
import type { McpState } from '../src/mcp-state';

const run = promisify(execFile);

describe('Branch Diff MCP service', () => {
  it('serves the saved session filters, author patch, complete branch patch, and source context', async () => {
    const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-mcp-repo-'));
    await git(repositoryPath, ['init', '-b', 'main']);
    await git(repositoryPath, ['config', 'user.name', 'Base User']);
    await git(repositoryPath, ['config', 'user.email', 'base@example.test']);
    await writeFile(join(repositoryPath, 'shared.txt'), 'base\n');
    await git(repositoryPath, ['add', '.']);
    await git(repositoryPath, ['commit', '-m', 'base']);
    await git(repositoryPath, ['switch', '-c', 'feature']);

    await git(repositoryPath, ['config', 'user.name', 'Alice']);
    await git(repositoryPath, ['config', 'user.email', 'alice@example.test']);
    await mkdir(join(repositoryPath, 'src', 'generated'), { recursive: true });
    await writeFile(join(repositoryPath, 'src', 'example.ts'), 'export const aliceLine = true;\n');
    await writeFile(join(repositoryPath, 'src', 'generated', 'skip.ts'), 'export const generated = true;\n');
    await git(repositoryPath, ['add', '.']);
    await git(repositoryPath, ['commit', '-m', 'alice change']);

    await git(repositoryPath, ['config', 'user.name', 'Bob']);
    await git(repositoryPath, ['config', 'user.email', 'bob@example.test']);
    await writeFile(join(repositoryPath, 'src', 'example.ts'), 'export const aliceLine = true;\nexport const bobLine = true;\n');
    await git(repositoryPath, ['add', '.']);
    await git(repositoryPath, ['commit', '-m', 'bob follow-up']);

    const statePath = join(repositoryPath, 'mcp-state.json');
    const state: McpState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      activeSessionId: 'default',
      sessions: [{
        id: 'default',
        name: 'Default',
        config: {
          repositoryPath,
          baseBranch: 'main',
          authorKeyword: 'alice@example',
          ui: { excludeDirectories: 'generated' },
        },
      }],
      repositories: {
        [repositoryPath]: {
          defaultBaseBranch: 'main',
          maxChangedLines: 20_000,
          gitMaxOutputBufferMB: 64,
          gitCommandTimeoutMs: 0,
        },
      },
    };
    await writeFile(statePath, JSON.stringify(state));

    const service = new BranchDiffMcpService(statePath);
    const sessions = await service.listSessions() as { activeSessionId: string; sessions: unknown[] };
    expect(sessions.activeSessionId).toBe('default');
    expect(sessions.sessions).toHaveLength(1);

    const summary = await service.getSummary() as {
      visibleTotals: { files: number; additions: number };
      session: { authorKeyword: string };
    };
    expect(summary.session.authorKeyword).toBe('alice@example');
    expect(summary.visibleTotals.files).toBe(1);
    expect(summary.visibleTotals.additions).toBe(2);

    const listed = await service.listFiles(undefined, { limit: 1 }) as {
      total: number;
      files: Array<{ path: string; additions: number }>;
    };
    expect(listed.total).toBe(1);
    expect(listed.files).toEqual([expect.objectContaining({ path: 'src/example.ts', additions: 2 })]);

    const filtered = await service.getFilteredDiff(undefined, 'src/example.ts', { maxLines: 200 }) as { text: string };
    expect(filtered.text).toContain('+export const aliceLine = true;');
    expect(filtered.text).not.toContain('bobLine');

    const complete = await service.getBranchDiff(undefined, 'src/example.ts', { maxLines: 200 }) as { text: string };
    expect(complete.text).toContain('aliceLine');
    expect(complete.text).toContain('bobLine');

    const context = await service.readFileContext(undefined, 'src/example.ts', 'current', { maxLines: 20 }) as { text: string };
    expect(context.text).toContain('aliceLine');
    expect(context.text).toContain('bobLine');

    const authorBefore = await service.readFileContext(undefined, 'src/example.ts', 'author_before', { maxLines: 20 }) as { text: string };
    expect(authorBefore.text).not.toContain('aliceLine');
    expect(authorBefore.text).toContain('bobLine');

    const commits = await service.listMatchingCommits(undefined, {}) as { total: number; commits: Array<{ authorName: string }> };
    expect(commits.total).toBe(1);
    expect(commits.commits[0].authorName).toBe('Alice');

    const search = await service.searchChanges(undefined, 'aliceLine', {}) as { total: number; matches: Array<{ path: string }> };
    expect(search.total).toBe(1);
    expect(search.matches[0].path).toBe('src/example.ts');

    await expect(service.getFilteredDiff(undefined, '../outside.ts', {})).rejects.toThrow(/not visible/);
  });
});

async function git(cwd: string, args: string[]): Promise<void> {
  await run('git', args, { cwd });
}
