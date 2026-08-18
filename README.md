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
  renames the file later.
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
- Exclude directories by name, relative directory path, or glob (`dist`,
  `src/generated`, `**/test/**`) without changing the base Git diff.
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

The extension invokes only your local `git` executable and does not send source
code, commit metadata, reviewer findings, or search queries over the network.

## Development

```sh
npm install
npm run check
npm test
npm run build
```

Press `F5` in VS Code to start an Extension Development Host. Build a VSIX with
`npm run package`.
