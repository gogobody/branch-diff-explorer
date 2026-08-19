# Changelog

All notable changes to Branch Diff Explorer are documented in this file.

## 0.1.32 - 2026-08-19

### Added

- Hierarchical branch-diff directory tree with final per-file line totals.
- Base-branch, single-commit, Git-state, file-type, glob, and changed-line filters.
- Commit-author name or email filtering across the complete branch history.
- Author-only highlights that preserve the complete current file and keep the
  working-tree side editable.
- Multi-root workspace selection and independently saved named sessions.
- File and directory context menus, including copy, reveal, search, and
  session-specific file/folder exclusions.
- Filtered diff export that preserves the repository directory structure.
- Bundled read-only MCP server for Codex, Claude Code, and other local AI clients.
- Configurable Git output buffer, command timeout, and changed-line preview limit.
- English and Simplified Chinese Marketplace documentation.

### Fixed

- Large Git commands no longer fail at Node's default stdout buffer limit.
- Files changed by multiple commits or Git states appear only once.
- Diff editors use the branch merge base and show the complete final comparison.
- Selected-author patches recover surviving edits after later context changes,
  insertions, replacements, and renames.
- Author and visible-tree line totals no longer accumulate intermediate commits
  or include hidden files and other authors.
- Changed-line searches scan complete patches beyond the UI preview limit.
- Header and MCP controls remain usable in narrow sidebars.

## 0.1.0 - 2026-08-18

- Initial local development release.
