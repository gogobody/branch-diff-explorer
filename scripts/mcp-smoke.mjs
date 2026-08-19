import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const run = promisify(execFile);
const repositoryPath = await mkdtemp(join(tmpdir(), 'branch-diff-mcp-smoke-'));

await git(['init', '-b', 'main']);
await git(['config', 'user.name', 'Base User']);
await git(['config', 'user.email', 'base@example.test']);
await writeFile(join(repositoryPath, 'README.md'), 'base\n');
await git(['add', '.']);
await git(['commit', '-m', 'base']);
await git(['switch', '-c', 'feature']);
await git(['config', 'user.name', 'MCP Author']);
await git(['config', 'user.email', 'mcp@example.test']);
await mkdir(join(repositoryPath, 'src'));
await writeFile(join(repositoryPath, 'src', 'change.ts'), 'export const mcp = true;\n');
await git(['add', '.']);
await git(['commit', '-m', 'MCP change']);

const statePath = join(repositoryPath, 'state.json');
await writeFile(statePath, JSON.stringify({
  version: 1,
  updatedAt: new Date().toISOString(),
  activeSessionId: 'smoke',
  sessions: [{
    id: 'smoke',
    name: 'Smoke',
    config: { repositoryPath, baseBranch: 'main', authorKeyword: 'mcp@example.test', ui: {} },
  }],
  repositories: {
    [repositoryPath]: {
      defaultBaseBranch: 'main',
      maxChangedLines: 20000,
      gitMaxOutputBufferMB: 64,
      gitCommandTimeoutMs: 0,
    },
  },
}));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist/mcp-server.js'), '--state', statePath],
  stderr: 'pipe',
});
const client = new Client({ name: 'branch-diff-mcp-smoke', version: '1.0.0' });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const expected = [
    'list_diff_sessions',
    'get_diff_summary',
    'list_diff_files',
    'get_filtered_diff',
    'get_branch_diff',
    'read_file_context',
    'list_matching_commits',
    'search_changes',
  ];
  for (const name of expected) {
    const tool = tools.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`Missing MCP tool: ${name}`);
    if (tool.annotations?.readOnlyHint !== true) throw new Error(`MCP tool is not marked read-only: ${name}`);
  }
  const summary = await client.callTool({ name: 'get_diff_summary', arguments: {} });
  if (summary.isError) throw new Error(`get_diff_summary failed: ${JSON.stringify(summary.content)}`);
  const files = await client.callTool({ name: 'list_diff_files', arguments: {} });
  if (files.isError || !JSON.stringify(files.structuredContent).includes('src/change.ts')) {
    throw new Error(`list_diff_files did not return the filtered change: ${JSON.stringify(files.content)}`);
  }
  const diff = await client.callTool({
    name: 'get_filtered_diff',
    arguments: { path: 'src/change.ts', maxLines: 100 },
  });
  if (diff.isError || !JSON.stringify(diff.structuredContent).includes('export const mcp = true')) {
    throw new Error(`get_filtered_diff did not return the author patch: ${JSON.stringify(diff.content)}`);
  }
  process.stdout.write(`MCP STDIO smoke test passed · ${tools.tools.length} read-only tools\n`);
} finally {
  await client.close();
}

async function git(args) {
  await run('git', args, { cwd: repositoryPath });
}
