# Branch Diff Explorer

[English](#english) | [简体中文](#zh-cn)

<a id="english"></a>

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

---

<a id="zh-cn"></a>

## 简体中文

Branch Diff Explorer 是一个完全在本地运行的 VS Code 插件，用于只查看和
审查当前 Git 分支相关的改动。插件没有许可证校验、使用次数限制、遥测或付费
功能。

### 功能

- 搜索已提交、已暂存和未暂存改动中的新增行与删除行。
- 目录树中每个路径只显示一次，即使文件经过多次提交或同时存在于多个 Git
  状态；文件的增删行数只反映最终 Diff，不累加中间提交。
- 已删除文件不会显示在目录树中，但其删除行仍保留在未过滤的分支范围汇总中。
- 可以与任意本地或远程基线分支比较。
- 支持按变更类型、Git 状态、扩展名和 Glob 表达式过滤。
- 普通分支改动、作者过滤改动和单次提交都使用 VS Code 原生左右对比窗口打开。
- 点击文件时打开基线分支到当前工作区的完整 Diff；选择 Single commit 时，则
  打开该提交的父提交到该提交的 Diff。
- 目录树和 Diff 编辑器使用相同的 Git merge base，因此分支分叉后基线分支
  新增的无关改动不会混入 Diff 左侧。
- 按 Commit Author 过滤时，Diff 仍显示完整当前文件，但只高亮匹配作者的改动。
- 即使其他提交修改了周围上下文、在纯新增或混合替换块中继续插入内容，或者
  后续重命名文件，作者高亮仍会尽量保持准确。较大的编辑块会优先使用函数签名
  等唯一代码行作为锚点，再匹配常见的大括号和空白行。如果某项作者改动已经被
  覆盖或移动到无法安全定位的位置，Diff 标题会明确提示，而不会静默遗漏。
- Author 模式下文件行数使用对应路径最终的 `base → working tree` Diff 统计，
  不会把匹配作者每次提交的修改重复累加。
- 如果文件在基线分支中不存在，Diff 会显示完整当前文件，但只高亮选定作者添加
  的代码行。
- 可以从虚拟 Git Diff 窗口执行 Go to Definition、Declaration、Type Definition
  和 Implementation，目标会在当前 Workspace 的真实源码中打开。
- 支持一次只查看和审查一个提交。
- **按提交作者过滤分支 Diff。** 可以通过 **Author contains** 使用姓名或邮箱
  关键字筛选提交。
- 作者过滤会扫描完整分支提交范围，不会在 250 个提交处静默停止；大型提交历史
  会按有界批次读取匹配补丁。
- 支持按目录名称、仓库相对路径或 Glob 排除目录，例如 `dist`、
  `src/generated`、`**/test/**`，不会改变底层基线 Diff。
- 可以把当前过滤后可见的全部文件导出到指定目录。导出会保留仓库目录结构，
  在源码文件名后添加 `.diff`，内容包含标准 Unified Diff 标记和 Hunk。
- 通过内置的只读 STDIO MCP Server，把已保存会话及其实时过滤后的 Git 数据
  提供给本地 AI 客户端。MCP 与目录树和导出功能使用相同的作者、搜索、状态、
  扩展名、Glob、排除目录和删除文件规则。
- 文件右键菜单支持打开文件、打开 Diff、在系统文件管理器中显示，以及复制相对
  路径、绝对路径、文件名或 URI。目录右键菜单支持在 Explorer 或系统文件管理器
  中显示、在目录内搜索，以及复制相对路径、绝对路径、目录名或 URI。
- 兼容 Reviewer Cockpit：读取 `.diffly/findings.json`，显示审查摘要、问题和
  缺失项，支持 Agree/Skip 分类，并在已打开编辑器中装饰问题行。
- 当基线分支领先当前分支时给出提示，并在 Git 状态或
  `.diffly/findings.json` 发生变化时刷新。
- 支持 Multi-root Workspace，并在会话中记住所选仓库。
- 可以创建任意数量的命名会话。每个会话分别保存 Workspace folder、基线分支、
  Author/Commit 范围、搜索选项、文件过滤器和排除目录。

### 使用方法

1. 在 VS Code 中打开一个 Git 仓库。
2. 从 Activity Bar 打开 **Branch Diff**，或者执行命令
   **Branch Diff Explorer: Open Sidebar**。
3. 选择基线分支。默认依次从 `origin/HEAD`、`main`、`master` 自动检测。
4. 可选：设置 Author contains 或选择 Single commit。Author 模式会主动隐藏
   未提交改动，因为这些改动没有 Commit Author。
5. 在 Multi-root Workspace 中选择 **Workspace folder**。使用 **Session**
   下拉框旁的新增、重命名和删除按钮管理相互独立的 Diff 配置。
6. 执行 **Branch Diff Explorer: Open Settings** 配置默认基线分支、预览行数、
   Git 输出缓冲区或 Git 命令超时。异常界面也提供设置入口。
7. 点击顶部的 **Export filtered diffs**（`⇩`），选择目标目录，并在覆盖已有
   `.diff` 文件前确认。
8. 点击顶部 **MCP**，复制 Codex 或 Claude Code 配置，或者运行本地 MCP
   自检。MCP Server 要求 Node.js 18 或更高版本；如果 `node` 不在 PATH 中，
   请设置 **MCP: Node Command**。

### 通过 MCP 向 AI 提供改动

插件会把内置 MCP 运行文件复制到稳定的 VS Code 存储目录，并把所有已保存会话
同步到当前 Workspace 专属的状态文件。AI 调用工具时，MCP Server 会重新计算
Git 改动；完成配置后不要求预先导出 Diff，也不要求 VS Code 窗口一直打开。

Codex：点击 **MCP → Copy Codex MCP configuration**，把生成的 TOML 添加到
`~/.codex/config.toml`，或者受信任项目的 `.codex/config.toml`，然后重启
Codex 客户端。Codex Desktop、CLI 和 IDE 插件支持本地 STDIO MCP，并共享同一
份配置。参见 [Codex MCP 官方文档](https://developers.openai.com/codex/mcp)。

Claude Code：点击 **MCP → Copy Claude Code MCP configuration**，把生成的
JSON 合并到项目 `.mcp.json` 中，然后重新连接客户端。生成的配置只包含本地
Node 命令、内置 Server 路径和 Workspace 状态文件路径。

#### 推荐的 MCP 调用流程

MCP 客户端可以根据自然语言请求自动选择工具。为了让审查稳定并减少 Token
消耗，建议让 AI 按以下顺序调用：

1. 调用 `list_diff_sessions` 找到活动会话或指定会话。
2. 调用 `get_diff_summary` 确认仓库、当前分支、基线分支、Author/Commit
   范围、过滤条件和可见文件汇总。
3. 分页调用 `list_diff_files`，获取目录树中实际显示的完整文件集合。
4. 对需要审查的文件调用 `get_filtered_diff`。
5. 当补丁上下文不足时，使用 `read_file_context` 读取完整源码。
6. 只有在需要对比所有作者的完整分支改动时，才调用 `get_branch_diff`。

#### MCP 工具说明

所有工具都是只读的，并接受可选的 `sessionId`。不传时使用 Branch Diff
Explorer 当前活动会话。

| 工具 | 用途 | 重要参数 |
| --- | --- | --- |
| `list_diff_sessions` | 列出已保存会话、活动会话、仓库路径、基线分支、Author/Commit 范围和 UI 过滤器。 | 无参数。 |
| `get_diff_summary` | 返回分支信息、范围总计、目录树可见总计、隐藏文件数和过滤语义。 | `sessionId`；`refresh: true` 强制重新执行 Git 计算。 |
| `list_diff_files` | 分页列出经过全部会话过滤后仍然可见的唯一、非 deleted 文件。 | `pathPrefix`、`cursor`、`limit`（最大 200）。 |
| `get_filtered_diff` | 读取一个可见文件经过 Author 或 Commit 过滤后的补丁。 | `list_diff_files` 返回的精确 `path`、`startLine`、`maxLines`（最大 5,000）。 |
| `get_branch_diff` | 读取一个可见文件从 merge-base 到工作区的完整补丁，包含所有作者。 | 精确 `path`、`startLine`、`maxLines`。 |
| `read_file_context` | 从工作区、HEAD、merge base 或 Author Diff 左侧读取完整源码上下文。 | 精确 `path`、`side`、`startLine`、`maxLines`。 |
| `list_matching_commits` | 分页列出 Author contains、选定作者或 Single commit 范围内的提交。 | `cursor`、`limit`（最大 200）。 |
| `search_changes` | 搜索改动行，同时保留会话的文件、Glob、扩展名、状态和排除目录过滤。 | `query`、`caseSensitive`、`regex`、`wholeWord`、`cursor`、`limit`。 |

`get_diff_summary` 会返回两组含义不同的汇总：

- `scopeTotals`：应用 UI 文件过滤前，完整 Author 或 Commit 范围的汇总。
- `visibleTotals`：应用全部 UI 过滤并移除 deleted 文件后，实际可通过
  `list_diff_files`、导出和目录树访问的汇总。

启用 **Author contains** 时，`get_filtered_diff.text` 只包含匹配作者的补丁；
但其中每个文件的 `additions` 和 `deletions` 仍表示对应路径最终的
`base → working tree` Diff 行数，不会累加作者的每次提交。
`get_branch_diff` 会有意包含其他作者的改动，因此 Author 审查时不能用它替代
`get_filtered_diff`。

`read_file_context.side` 支持：

- `current`（默认）：当前工作区内容。
- `head`：`HEAD` 中的文件内容。
- `base`：本次比较所使用的 Git merge base 内容。
- `author_before`：在当前文件中撤销所选作者补丁后的内容，对应 VS Code Author
  Diff 左侧。仅 Author 过滤会话支持此模式。

#### 分页示例

文件和提交列表会返回 `nextCursor`。持续把它传回下一次调用，直到返回值中不再
包含该字段：

```json
{
  "sessionId": "session-id",
  "pathPrefix": "src/services",
  "cursor": 0,
  "limit": 100
}
```

Diff 和源码工具会返回 `nextStartLine`。文本页默认返回 800 行，每次最多支持
5,000 行：

```json
{
  "sessionId": "session-id",
  "path": "src/services/example.ts",
  "startLine": 1,
  "maxLines": 1000
}
```

文件参数必须使用 `list_diff_files` 返回的精确仓库相对路径。

#### 推荐审查提示词

```text
使用 branch-diff-explorer MCP。先列出已保存的 Diff 会话并汇总当前活动会话，
然后分页读取 list_diff_files 返回的全部文件。使用 get_filtered_diff 审查文件，
确保范围只包含当前选择的 Author 或 Commit；需要完整源码上下文时调用
read_file_context。只有需要把作者补丁与完整分支改动比较时才调用
get_branch_diff。输出问题严重程度、文件路径、相关行、原因和修复建议。
```

针对特定内容搜索：

```text
在当前过滤后的改动中搜索 glfs_bdev_get_route_stats，然后读取匹配文件的
filtered diff、current 源码和 author_before 源码上下文。
```

只审查特定目录：

```text
只审查 source/services/spdk 下的文件。调用 list_diff_files 时使用
pathPrefix，跟随所有分页 cursor，并且不要审查其他作者的改动。
```

#### MCP 排障

- 如果客户端中没有 Server，重启 Codex 或 Claude 客户端并检查 MCP Server
  列表；Codex 中可以使用 `/mcp`。
- 如果结果看起来没有更新，调用 `get_diff_summary` 时传入 `refresh: true`。
- 如果路径被拒绝，重新从 `list_diff_files` 获取并传入完全一致的路径。
- 如果响应被截断，继续跟随 `nextCursor` 或 `nextStartLine`，不要把当前页当作
  完整结果。
- `author_before` 要求当前会话已经启用 Author 过滤。
- MCP 不会把二进制文件、符号链接目标或超过 32 MB 的文件作为源码上下文返回。

插件只调用本地 `git` 命令，不会通过网络发送源码、Commit Metadata、Reviewer
问题或搜索内容。MCP Server 使用本地 STDIO，不会监听网络端口。

### 开发

```sh
npm install
npm run check
npm test
npm run build
```

在 VS Code 中按 `F5` 启动 Extension Development Host。使用
`npm run package` 构建 VSIX。
