#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';
import { BranchDiffMcpService } from './mcp-service';

const SERVER_VERSION = '0.1.22';
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function createBranchDiffMcpServer(service: BranchDiffMcpService): McpServer {
  const server = new McpServer({
    name: 'branch-diff-explorer',
    version: SERVER_VERSION,
  }, {
    instructions: 'Read-only access to Branch Diff Explorer sessions and their filtered Git changes. Start with list_diff_sessions, then get_diff_summary and list_diff_files. Use get_filtered_diff for the selected author/commit scope, get_branch_diff for the complete branch change, and read_file_context for full source context. Results are paginated; follow nextCursor or nextStartLine. Never assume filtered and complete branch patches are equivalent.',
  });

  server.registerTool('list_diff_sessions', {
    title: 'List branch diff sessions',
    description: 'List the saved Branch Diff Explorer sessions, repositories, author scopes, and UI filters. The active session is identified separately.',
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => result(() => service.listSessions()));

  server.registerTool('get_diff_summary', {
    title: 'Get diff summary',
    description: 'Get branch/base metadata, active author or commit scope, overall totals, and totals for files visible after all session filters.',
    inputSchema: {
      sessionId: z.string().optional().describe('Saved session ID. Omit to use the active session.'),
      refresh: z.boolean().optional().describe('Recompute Git data instead of using the short-lived cache.'),
    },
    annotations: READ_ONLY,
  }, async ({ sessionId, refresh }) => result(() => service.getSummary(sessionId, refresh)));

  server.registerTool('list_diff_files', {
    title: 'List filtered diff files',
    description: 'Page through unique, non-deleted files visible in a session after author, search, status, extension, glob, and excluded-directory filters.',
    inputSchema: {
      sessionId: z.string().optional().describe('Saved session ID. Omit to use the active session.'),
      pathPrefix: z.string().optional().describe('Optional repository-relative directory prefix.'),
      cursor: z.number().int().min(0).optional().describe('Zero-based cursor returned by the previous page.'),
      limit: z.number().int().min(1).max(200).optional().describe('Page size, from 1 to 200.'),
    },
    annotations: READ_ONLY,
  }, async ({ sessionId, pathPrefix, cursor, limit }) => result(() => service.listFiles(sessionId, { pathPrefix, cursor, limit })));

  server.registerTool('get_filtered_diff', {
    title: 'Read filtered file diff',
    description: 'Read a visible file patch in the session scope. With Author contains this contains only matching-author commits; with a selected commit it contains only that commit.',
    inputSchema: {
      sessionId: z.string().optional().describe('Saved session ID. Omit to use the active session.'),
      path: z.string().min(1).describe('Exact repository-relative path from list_diff_files.'),
      startLine: z.number().int().min(1).optional().describe('One-based patch line at which to start.'),
      maxLines: z.number().int().min(1).max(5000).optional().describe('Maximum patch lines to return.'),
    },
    annotations: READ_ONLY,
  }, async ({ sessionId, path, startLine, maxLines }) => result(() => service.getFilteredDiff(sessionId, path, { startLine, maxLines })));

  server.registerTool('get_branch_diff', {
    title: 'Read complete branch file diff',
    description: 'Read the complete merge-base-to-working-tree patch for a visible file, without limiting hunks to the selected commit author.',
    inputSchema: {
      sessionId: z.string().optional().describe('Saved session ID. Omit to use the active session.'),
      path: z.string().min(1).describe('Exact repository-relative path from list_diff_files.'),
      startLine: z.number().int().min(1).optional().describe('One-based patch line at which to start.'),
      maxLines: z.number().int().min(1).max(5000).optional().describe('Maximum patch lines to return.'),
    },
    annotations: READ_ONLY,
  }, async ({ sessionId, path, startLine, maxLines }) => result(() => service.getBranchDiff(sessionId, path, { startLine, maxLines })));

  server.registerTool('read_file_context', {
    title: 'Read complete file context',
    description: 'Read a line range from the current, HEAD, merge-base, or author-before version of a visible file. author_before matches the left side of the author-filtered VS Code diff.',
    inputSchema: {
      sessionId: z.string().optional().describe('Saved session ID. Omit to use the active session.'),
      path: z.string().min(1).describe('Exact repository-relative path from list_diff_files.'),
      side: z.enum(['current', 'head', 'base', 'author_before']).optional().describe('File version to read. Defaults to current.'),
      startLine: z.number().int().min(1).optional().describe('One-based source line at which to start.'),
      maxLines: z.number().int().min(1).max(5000).optional().describe('Maximum source lines to return.'),
    },
    annotations: READ_ONLY,
  }, async ({ sessionId, path, side, startLine, maxLines }) => result(() => service.readFileContext(
    sessionId,
    path,
    side ?? 'current',
    { startLine, maxLines },
  )));

  server.registerTool('list_matching_commits', {
    title: 'List matching commits',
    description: 'List commits selected by the session author keyword, author IDs, or single-commit scope.',
    inputSchema: {
      sessionId: z.string().optional().describe('Saved session ID. Omit to use the active session.'),
      cursor: z.number().int().min(0).optional().describe('Zero-based cursor returned by the previous page.'),
      limit: z.number().int().min(1).max(200).optional().describe('Page size, from 1 to 200.'),
    },
    annotations: READ_ONLY,
  }, async ({ sessionId, cursor, limit }) => result(() => service.listMatchingCommits(sessionId, { cursor, limit })));

  server.registerTool('search_changes', {
    title: 'Search changed lines',
    description: 'Search complete filtered patch lines while preserving the session file/status/glob/excluded-directory filters.',
    inputSchema: {
      sessionId: z.string().optional().describe('Saved session ID. Omit to use the active session.'),
      query: z.string().min(1).describe('Changed-line search text or regular expression.'),
      caseSensitive: z.boolean().optional(),
      regex: z.boolean().optional(),
      wholeWord: z.boolean().optional(),
      cursor: z.number().int().min(0).optional().describe('Zero-based cursor returned by the previous page.'),
      limit: z.number().int().min(1).max(200).optional().describe('Page size, from 1 to 200.'),
    },
    annotations: READ_ONLY,
  }, async ({ sessionId, query, caseSensitive, regex, wholeWord, cursor, limit }) => result(() => service.searchChanges(
    sessionId,
    query,
    { caseSensitive, regex, wholeWord, cursor, limit },
  )));

  return server;
}

async function result(load: () => Promise<object>): Promise<{
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  try {
    const value = await load() as Record<string, unknown>;
    return {
      content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      structuredContent: value,
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

function statePathFromArgs(args: string[]): string {
  const index = args.indexOf('--state');
  const statePath = index >= 0 ? args[index + 1] : undefined;
  if (!statePath) throw new Error('Missing required --state <path> argument. Copy the MCP configuration from Branch Diff Explorer.');
  return statePath;
}

async function main(): Promise<void> {
  const service = new BranchDiffMcpService(statePathFromArgs(process.argv.slice(2)));
  if (process.argv.includes('--self-test')) {
    process.stdout.write(`${JSON.stringify(await service.listSessions())}\n`);
    return;
  }
  const server = createBranchDiffMcpServer(service);
  await server.connect(new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 16 * 1024 * 1024 }));
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`Branch Diff Explorer MCP error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
