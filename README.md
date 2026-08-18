# Branch Diff Explorer

An all-local VS Code extension for reviewing just the changes related to your
current Git branch. It has no license checks, usage limits, telemetry, or paid
features.

## Features

- Search additions and deletions across committed, staged, and unstaged changes.
- Compare your branch with any local or remote base branch.
- Filter by file change kind, Git state, extension, and glob patterns.
- Open normal changes in VS Code's side-by-side diff editor.
- Inspect one commit at a time.
- **Filter branch diffs by commit author.** Select one or more authors and the
  view shows only patches produced by their commits after the selected base.
  The **Author contains** field also filters by a name or email keyword.
- Exclude directories by name, relative directory path, or glob (`dist`,
  `src/generated`, `**/test/**`) without changing the base Git diff.
- Right-click any changed file to open it, open its diff, reveal it in the OS
  file manager, or copy its relative path, absolute path, file name, or URI.
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
