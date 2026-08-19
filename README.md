# Branch Diff Explorer

An all-local VS Code extension for reviewing just the changes related to your
current Git branch. It has no license checks, usage limits, telemetry, or paid
features.

## Features

- Search additions and deletions across committed, staged, and unstaged changes.
- Shows each changed path once in the directory tree, even when it was changed in
  several commits or Git states; its line totals reflect only the final diff.
- Keeps deleted files out of the directory tree while retaining their removals
  in the branch summary totals.
- Compare your branch with any local or remote base branch.
- Filter by file change kind, Git state, extension, and glob patterns.
- Open normal changes, author-filtered changes, and single commits in VS Code's
  native side-by-side diff editor.
- File rows open the complete base-branch-to-working-tree diff; when a single
  commit is selected, they open that commit's parent-to-commit diff instead.
- The directory tree and diff editor use the same Git merge base, so changes
  added independently to the base branch after divergence do not leak into the
  left side of a branch diff.
- When filtering by commit author, file diffs include only the matching authors'
  highlighted changes while keeping the rest of the current file visible.
- Author highlights remain accurate when another commit changes surrounding
  context, inserts inside pure additions or mixed replacement blocks, or
  renames the file later. Large edited blocks use unique lines such as function
  signatures as anchors before matching common braces and whitespace.
  If an author edit has been overwritten or moved beyond safe matching, the
  diff title calls that out instead of silently hiding it.
- Author-filtered rows use final `base → working tree` line totals for each
  matching path, rather than adding up edits from every matching commit.
- For a file absent from the base branch, the complete current file remains
  visible, while only lines from the selected author are highlighted.
- Go to Definition, Declaration, Type Definition, and Implementation from a
  virtual Git diff pane; the destination opens in the active workspace source.
- Inspect one commit at a time.
- **Filter branch diffs by commit author.** Select one or more authors and the
  view shows only patches produced by their commits after the selected base.
  The **Author contains** field also filters by a name or email keyword.
- Author filtering scans the complete branch range instead of silently stopping
  at 250 commits. Matching patches are loaded in bounded batches for large
  histories.
- Exclude directories by name, relative directory path, or glob (`dist`,
  `src/generated`, `**/test/**`) without changing the base Git diff.
- Export every file currently visible after filtering to a selected directory.
  Exports preserve the repository directory tree, append `.diff` to each source
  filename, and contain standard unified diff markers and hunks.
- Expose saved sessions and their live filtered Git data to local AI clients
  through a bundled, read-only STDIO MCP server. MCP uses the same author,
  search, status, extension, glob, excluded-directory, and deleted-file rules
  as the tree and export action.
- Right-click any changed file to open it, open its diff, reveal it in the OS
  file manager, or copy its relative path, absolute path, file name, or URI.
  Right-click a directory to reveal it in Explorer or the OS, search within it,
  or copy its relative path, absolute path, name, or URI.
- Reviewer cockpit compatibility: reads `.diffly/findings.json`, shows briefing,
  findings and missing-work items, supports Agree/Skip triage, and decorates
  flagged lines in open editors.
- Shows when the selected base branch is ahead of the current branch and refreshes
  when Git state or `.diffly/findings.json` changes.
- Supports multi-root workspaces and remembers the selected repository during a
  session.
- Create unlimited named sessions. Each session saves its workspace folder, base
  branch, author/commit scope, search options, file filters, and excluded
  directories independently in VS Code workspace storage.

## Use

1. Open a Git repository in VS Code.
2. Open **Branch Diff** from the Activity Bar, or run
   **Branch Diff Explorer: Open Sidebar**.
3. Choose a base branch. The default is automatically detected from
   `origin/HEAD`, then `main`, then `master`.
4. Optionally choose an author or a commit; author mode intentionally hides
   uncommitted work because it cannot have a commit author yet.
5. In a multi-root workspace, select **Workspace folder**. Use the **Session**
   picker’s `+`, rename, and delete controls to manage independent diff setups.
6. Open **Branch Diff Explorer: Open Settings** to configure the base branch,
   preview line limit, Git output buffer, or Git command timeout. The error UI
   also links to these settings.
7. Use the **Export filtered diffs** button (`⇩`) in the header, select a target
   directory, and confirm before overwriting any existing exported `.diff` files.
8. Use **MCP** in the header to copy a Codex or Claude Code configuration, or to
   run the local MCP self-test. The server requires Node.js 18 or newer; set
   **MCP: Node Command** if `node` is not on PATH.

## AI access through MCP

The extension copies its bundled MCP runtime to stable VS Code storage and
keeps a workspace-specific state file synchronized with all saved sessions.
The server recalculates Git changes when an AI client calls it; exported diff
files and an open VS Code window are not required after configuration.

For Codex, copy the generated TOML into `~/.codex/config.toml` or a trusted
project's `.codex/config.toml`, then restart the local Codex client. Codex
desktop, CLI, and IDE clients support local STDIO MCP servers and share this
configuration. See the [official Codex MCP documentation](https://developers.openai.com/codex/mcp).

For Claude Code, merge the generated JSON object into the project's `.mcp.json`
and reconnect the client. The generated configuration contains only a local
Node command, the bundled server path, and the workspace state-file path.

### Recommended MCP workflow

MCP clients can select tools from a natural-language request. For reliable,
token-efficient reviews, ask the client to follow this sequence:

1. Call `list_diff_sessions` to find the active or requested session.
2. Call `get_diff_summary` to confirm the repository, branch, comparison base,
   author or commit scope, filters, and visible totals.
3. Page through `list_diff_files` to obtain the exact set of files shown in the
   directory tree.
4. Read `get_filtered_diff` for each file being reviewed.
5. Use `read_file_context` when a patch does not contain enough surrounding
   source code.
6. Use `get_branch_diff` only when the complete all-author branch change is
   required for comparison.

### MCP tool reference

All tools are read-only and accept an optional `sessionId`. When it is omitted,
the active Branch Diff Explorer session is used.

| Tool | Purpose | Important inputs |
| --- | --- | --- |
| `list_diff_sessions` | List saved sessions, the active session, repository paths, branch bases, author/commit scopes, and UI filters. | No inputs. |
| `get_diff_summary` | Return branch metadata, scope totals, directory-tree-visible totals, hidden-file count, and filter semantics. | `sessionId`; `refresh: true` forces a fresh Git calculation. |
| `list_diff_files` | Page through unique, non-deleted files that remain after all session filters. | `pathPrefix`, `cursor`, `limit` (maximum 200). |
| `get_filtered_diff` | Read the author- or commit-filtered patch for one visible file. | Exact `path` from `list_diff_files`, `startLine`, `maxLines` (maximum 5,000). |
| `get_branch_diff` | Read the complete merge-base-to-working-tree patch for one visible file, including every author. | Exact `path`, `startLine`, `maxLines`. |
| `read_file_context` | Read full source context from the working tree, HEAD, merge base, or the left side of an author-filtered diff. | Exact `path`, `side`, `startLine`, `maxLines`. |
| `list_matching_commits` | Page through commits selected by Author contains, selected authors, or a single-commit scope. | `cursor`, `limit` (maximum 200). |
| `search_changes` | Search changed lines while retaining the session's file, glob, extension, status, and excluded-directory filters. | `query`, `caseSensitive`, `regex`, `wholeWord`, `cursor`, `limit`. |

`get_diff_summary` reports two intentionally different totals:

- `scopeTotals` describes the complete author or commit scope before UI file
  filters.
- `visibleTotals` describes exactly the non-deleted files available through
  `list_diff_files`, export, and the directory tree after all UI filters.

With **Author contains**, `get_filtered_diff.text` contains only matching-author
patches. Its per-file `additions` and `deletions` remain the final
base-to-working-tree totals for that matching path; they are not accumulated
from every author commit. `get_branch_diff` deliberately includes other
authors' changes, so it must not replace `get_filtered_diff` during an
author-scoped review.

`read_file_context.side` accepts:

- `current` (default): current working-tree contents.
- `head`: the file at `HEAD`.
- `base`: the file at the Git merge base used by the comparison.
- `author_before`: current contents with the selected author's patch reverted,
  matching the left side of the VS Code author-filtered diff. This side is only
  available in author-filtered sessions.

### Pagination examples

File and commit lists return `nextCursor`. Pass it back until it is absent:

```json
{
  "sessionId": "session-id",
  "pathPrefix": "src/services",
  "cursor": 0,
  "limit": 100
}
```

Diff and source tools return `nextStartLine`. Text pages default to 800 lines
and support up to 5,000 lines per call:

```json
{
  "sessionId": "session-id",
  "path": "src/services/example.ts",
  "startLine": 1,
  "maxLines": 1000
}
```

Always use the exact repository-relative path returned by `list_diff_files`.

### Suggested review prompt

```text
Use the branch-diff-explorer MCP. First list the saved diff sessions and
summarize the active session. Page through every file returned by
list_diff_files. Review get_filtered_diff so the review remains limited to the
selected author or commit, and use read_file_context when full source context is
needed. Use get_branch_diff only to compare the selected-author patch with the
complete branch change. Report findings with severity, file path, relevant
lines, reasoning, and a suggested fix.
```

Useful focused requests include:

```text
Search the active filtered changes for glfs_bdev_get_route_stats, then read the
matching file's filtered diff and its current and author_before source context.
```

```text
Review only files under source/services/spdk. Use pathPrefix when listing files,
follow every pagination cursor, and do not review changes from other authors.
```

### MCP troubleshooting

- If the server is missing, restart the Codex or Claude client and inspect its
  MCP server list. In Codex, use `/mcp`.
- If results appear stale, call `get_diff_summary` with `refresh: true`.
- If a path is rejected, retrieve it again from `list_diff_files` and pass the
  exact returned path.
- If a response is truncated, follow `nextCursor` or `nextStartLine` instead of
  assuming the result is complete.
- `author_before` requires an author-filtered session.
- Binary files, symbolic-link targets, and source files larger than 32 MB are
  not returned as source context.

The extension invokes only your local `git` executable and does not send source
code, commit metadata, reviewer findings, or search queries over the network.
The MCP server is local STDIO and exposes no listening network port.

## Development

```sh
npm install
npm run check
npm test
npm run build
```

Press `F5` in VS Code to start an Extension Development Host. Build a VSIX with
`npm run package`.
