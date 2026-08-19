import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createWebviewHtml } from '../src/webview';

describe('Branch Diff Explorer webview', () => {
  it('produces a syntactically valid, self-contained client script', () => {
    const html = createWebviewHtml({} as never);
    const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)?.[1];

    expect(script).toBeDefined();
    expect(() => new Script(script!)).not.toThrow();
    expect(html).toContain('Author contains');
    expect(html).toContain('Workspace folder');
    expect(html).toContain('New session');
    expect(html).toContain('file-stats');
    expect(html).not.toContain('file-actions');
    expect(html).toContain('Exclude directories');
    expect(html).toContain("element('button', 'help-button', '?')");
    expect(html).toContain("helpButton.setAttribute('aria-expanded', 'false')");
    expect(html).toContain('** spans folders');
    expect(html).toContain('**/*.ts, !**/*.test.ts');
    expect(html).toContain('Author contains');
    expect(html).toContain('Copy absolute path');
    expect(html).toContain('Reveal in file manager');
    expect(html).toContain('showFolderContextMenu');
    expect(html).toContain('Reveal in Explorer');
    expect(html).toContain('Find in folder');
    expect(html).toContain('model.visibleFileKeys');
    expect(html).toContain("type: 'filter'");
    expect(html).toContain('summary-totals');
    expect(html).toContain('Open Settings');
    expect(html).toContain('Export filtered diffs');
    expect(html).toContain("type: 'exportDiffs'");
    expect(html).toContain("type: 'showMcpSetup'");
    expect(html).toContain("element('div', 'title-wrap')");
    expect(html).toContain("element('div', 'header-tools')");
    expect(html).toContain("element('button', 'mcp-action', 'MCP Setup')");
    expect(html).toContain("tools.append(mcp, element('span', 'header-spacer'), exportDiffs, refresh, panel)");
    expect(html).not.toContain('icon mcp-icon');
    expect(html).toContain('const files = visibleFiles()');
    expect(html).toContain('renderTreeRoot(tree, buildDirectoryTree(files))');
    expect(html).not.toContain('model.snapshot.repository.name, \'\', 0');
  });
});
