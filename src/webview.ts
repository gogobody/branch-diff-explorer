import * as vscode from 'vscode';

export function createWebviewHtml(webview: vscode.Webview): string {
  const nonce = randomNonce();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>Branch Diff Explorer</title>
  <style>
    :root { color-scheme: light dark; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
    * { box-sizing: border-box; }
    body { color: var(--vscode-foreground); background: var(--vscode-sideBar-background); margin: 0; padding: 0; }
    button, select, input { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; }
    button { cursor: pointer; padding: 4px 7px; }
    button:hover { background: var(--vscode-toolbar-hoverBackground); }
    button:focus-visible, select:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    select, input { min-width: 0; width: 100%; padding: 5px 6px; }
    #app { min-height: 100vh; }
    .header { position: sticky; top: 0; z-index: 2; padding: 10px 10px 9px; background: var(--vscode-sideBar-background); border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); box-shadow: 0 1px 0 color-mix(in srgb, var(--vscode-editor-background) 45%, transparent); }
    .title-row, .summary, .chips, .header-tools, .option-row { display: flex; align-items: center; gap: 6px; }
    .title-row { align-items: flex-start; justify-content: space-between; min-width: 0; }
    .title-wrap { flex: 1 1 auto; min-width: 0; }
    .title { font-size: 13px; font-weight: 700; letter-spacing: .15px; }
    .branch-context { align-items: center; color: var(--vscode-descriptionForeground); display: flex; font-family: var(--vscode-editor-font-family); font-size: 10px; gap: 4px; margin-top: 4px; max-width: 100%; min-width: 0; overflow: hidden; white-space: nowrap; }
    .branch-ref { background: var(--vscode-badge-background); border-radius: 2px; color: var(--vscode-badge-foreground); min-width: 0; overflow: hidden; padding: 1px 4px; text-overflow: ellipsis; }
    .branch-arrow { color: var(--vscode-descriptionForeground); }
    .header-tools { gap: 3px; margin-top: 7px; min-height: 24px; min-width: 0; }
    .header-spacer { flex: 1 1 auto; }
    .mcp-action { background: var(--vscode-button-secondaryBackground); border: 0; color: var(--vscode-button-secondaryForeground); flex: 0 0 auto; font-size: 10px; font-weight: 700; letter-spacing: .2px; line-height: 18px; padding: 2px 8px; }
    .mcp-action:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .icon { border: 0; background: transparent; border-radius: 3px; padding: 3px 5px; font-size: 16px; line-height: 18px; color: var(--vscode-icon-foreground); }
    .controls { padding: 10px 10px 7px; border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .field { min-width: 0; }
    .field.wide { grid-column: 1 / -1; }
    label { display: block; color: var(--vscode-descriptionForeground); margin: 0 0 3px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .35px; }
    .field-label { align-items: center; display: flex; gap: 4px; margin: 0 0 3px; }
    .field-label label { margin: 0; }
    .help-button { align-items: center; background: transparent; border: 1px solid var(--vscode-descriptionForeground); border-radius: 50%; color: var(--vscode-descriptionForeground); display: inline-flex; font-size: 9px; font-weight: 700; height: 14px; justify-content: center; line-height: 12px; padding: 0; width: 14px; }
    .help-button:hover { background: var(--vscode-toolbar-hoverBackground); color: var(--vscode-foreground); }
    .field-help { background: var(--vscode-textBlockQuote-background); border-left: 2px solid var(--vscode-focusBorder); color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.4; margin-top: 4px; padding: 5px 6px; }
    .author-keyword { font-family: var(--vscode-editor-font-family); }
    .session-control { display: flex; gap: 3px; }
    .session-control select { flex: 1; }
    .session-action { flex: 0 0 auto; font-size: 14px; line-height: 20px; min-width: 25px; padding: 1px 4px; }
    .filterbar { padding: 7px 10px; border-bottom: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); }
    .filterbar .grid { grid-template-columns: 1fr 1fr; }
    .filterbar .option-row { padding-top: 6px; flex-wrap: wrap; }
    .check { color: var(--vscode-descriptionForeground); display: inline-flex; align-items: center; gap: 3px; font-size: 11px; user-select: none; }
    .check input { appearance: auto; width: auto; margin: 0; }
    .exclude-editor { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; overflow: hidden; }
    .exclude-summary { align-items: center; color: var(--vscode-descriptionForeground); display: flex; font-size: 10px; justify-content: space-between; padding: 4px 5px 2px; }
    .exclude-clear { background: transparent; border: 0; color: var(--vscode-descriptionForeground); font-size: 10px; padding: 1px 3px; }
    .exclude-list { max-height: 86px; overflow-y: auto; padding: 2px 4px 4px; }
    .exclude-entry { align-items: center; background: var(--vscode-badge-background); border-radius: 3px; display: flex; margin-top: 2px; min-width: 0; }
    .exclude-entry input { background: transparent; border: 0; color: var(--vscode-badge-foreground); flex: 1 1 auto; font-family: var(--vscode-editor-font-family); font-size: 10px; min-width: 0; padding: 3px 5px; }
    .exclude-remove { background: transparent; border: 0; color: var(--vscode-badge-foreground); flex: 0 0 auto; font-size: 13px; line-height: 16px; padding: 1px 5px; }
    .exclude-add { border-top: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); display: flex; }
    .exclude-add input { background: transparent; border: 0; flex: 1 1 auto; font-family: var(--vscode-editor-font-family); font-size: 10px; min-width: 0; }
    .exclude-add button { background: transparent; border: 0; flex: 0 0 auto; font-size: 15px; min-width: 28px; }
    .summary { justify-content: space-between; padding: 7px 10px; color: var(--vscode-descriptionForeground); font-size: 11px; }
    .summary strong { color: var(--vscode-foreground); font-weight: 600; }
    .summary-totals { align-items: center; display: flex; font-family: var(--vscode-editor-font-family); gap: 7px; white-space: nowrap; }
    .summary-filtered { color: var(--vscode-descriptionForeground); font-size: 10px; margin-left: 4px; }
    .notice { margin: 0 10px 7px; padding: 6px 7px; background: var(--vscode-textBlockQuote-background); border-left: 2px solid var(--vscode-textBlockQuote-border); color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.35; }
    .tree { padding-bottom: 14px; }
    .folder { margin-top: 1px; }
    .folder-title { background: transparent; border: 0; border-radius: 0; color: var(--vscode-foreground); display: flex; font-size: 11px; font-weight: 600; gap: 3px; padding: 4px 8px; text-align: left; width: 100%; }
    .folder-title:hover { background: var(--vscode-list-hoverBackground); }
    .folder-chevron { color: var(--vscode-descriptionForeground); display: inline-block; text-align: center; width: 12px; }
    .folder-count { color: var(--vscode-descriptionForeground); font-size: 10px; font-weight: 400; margin-left: 3px; }
    .file-row { position: relative; }
    .file { border: 0; border-radius: 0; color: var(--vscode-foreground); background: transparent; display: block; padding: 6px 82px 7px 10px; text-align: left; width: 100%; }
    .file:hover { background: var(--vscode-list-hoverBackground); }
    .file:focus-visible { outline-offset: -2px; }
    .file-main { display: flex; min-width: 0; align-items: center; gap: 6px; }
    .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .badge { border-radius: 9px; display: inline-block; flex: 0 0 auto; font-size: 9px; font-weight: 700; line-height: 16px; min-width: 16px; padding: 0 4px; text-align: center; }
    .added { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); background: color-mix(in srgb, var(--vscode-gitDecoration-addedResourceForeground, #3fb950) 15%, transparent); }
    .modified { color: var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d); background: color-mix(in srgb, var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d) 15%, transparent); }
    .deleted { color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); background: color-mix(in srgb, var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c) 15%, transparent); }
    .renamed { color: var(--vscode-gitDecoration-renamedResourceForeground, #73c991); background: color-mix(in srgb, var(--vscode-gitDecoration-renamedResourceForeground, #73c991) 15%, transparent); }
    .severity { border-radius: 7px; font-size: 9px; font-weight: 700; line-height: 15px; padding: 0 4px; }
    .severity.critical { background: #f14c4c33; color: #f14c4c; }
    .severity.high { background: #ff880033; color: #ff8800; }
    .severity.medium { background: #e4c65233; color: #d7ba33; }
    .severity.low { background: #3794ff33; color: #3794ff; }
    .severity.nit { background: #85858533; color: var(--vscode-descriptionForeground); }
    .file-stats { align-items: center; display: flex; font-family: var(--vscode-editor-font-family); font-size: 11px; gap: 5px; position: absolute; right: 8px; top: 7px; }
    .plus { color: var(--vscode-gitDecoration-addedResourceForeground, #3fb950); }
    .minus { color: var(--vscode-gitDecoration-deletedResourceForeground, #f14c4c); }
    .empty { color: var(--vscode-descriptionForeground); padding: 26px 18px; line-height: 1.45; text-align: center; }
    .error { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); color: var(--vscode-inputValidation-errorForeground); margin: 10px; padding: 8px; }
    .error button { margin-top: 8px; }
    .loading { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .filter-spinner { animation: filter-spin .7s linear infinite; border: 1.5px solid var(--vscode-descriptionForeground); border-radius: 50%; border-top-color: transparent; display: inline-block; height: 11px; width: 11px; }
    @keyframes filter-spin { to { transform: rotate(360deg); } }
    .review { border-top: 1px solid var(--vscode-sideBar-border, var(--vscode-panel-border)); margin-top: 5px; padding: 8px 10px; }
    .review-heading { font-size: 11px; font-weight: 700; margin-bottom: 6px; }
    .briefing { background: var(--vscode-textBlockQuote-background); border-left: 2px solid var(--vscode-focusBorder); margin-bottom: 7px; padding: 6px 7px; }
    .briefing-intent { font-size: 11px; font-weight: 600; line-height: 1.35; }
    .briefing ul { color: var(--vscode-descriptionForeground); font-size: 11px; line-height: 1.35; margin: 5px 0 0 15px; padding: 0; }
    .finding { border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-descriptionForeground); border-radius: 3px; margin: 5px 0; padding: 6px; }
    .finding.critical { border-left-color: #f14c4c; }
    .finding.high { border-left-color: #ff8800; }
    .finding.medium { border-left-color: #d7ba33; }
    .finding.low { border-left-color: #3794ff; }
    .finding.nit { border-left-color: #858585; }
    .finding.triaged { opacity: .56; }
    .finding-title { font-size: 11px; font-weight: 600; line-height: 1.35; }
    .finding-meta { color: var(--vscode-descriptionForeground); font-size: 10px; line-height: 1.35; margin-top: 3px; }
    .finding-actions { display: flex; gap: 4px; margin-top: 5px; }
    .finding-actions button { font-size: 10px; padding: 2px 5px; }
    .context-menu { background: var(--vscode-menu-background); border: 1px solid var(--vscode-menu-border, var(--vscode-widget-border)); box-shadow: 0 4px 14px rgba(0, 0, 0, .25); min-width: 190px; padding: 4px; position: fixed; z-index: 100; }
    .context-menu button { background: transparent; border: 0; border-radius: 2px; color: var(--vscode-menu-foreground); display: flex; font-size: 12px; justify-content: space-between; padding: 5px 8px; text-align: left; width: 100%; }
    .context-menu button:hover { background: var(--vscode-menu-selectionBackground); color: var(--vscode-menu-selectionForeground); }
    .context-menu .menu-separator { border-top: 1px solid var(--vscode-menu-separatorBackground, var(--vscode-widget-border)); margin: 4px 2px; }
    @media (max-width: 360px) { .grid, .filterbar .grid { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { .filter-spinner { animation: none; border-top-color: var(--vscode-descriptionForeground); opacity: .65; } }
    @media (max-width: 190px) {
      .header { padding-left: 6px; padding-right: 6px; }
      .header-tools { gap: 1px; }
      .mcp-action { padding-left: 5px; padding-right: 5px; }
      .icon { padding-left: 3px; padding-right: 3px; }
    }
  </style>
</head>
<body>
  <main id="app" aria-live="polite"><div class="empty">Loading local Git changes…</div></main>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const app = document.getElementById('app');
    let model = { snapshot: null, visibleFileKeys: [], repositories: [], session: null, sessions: [], loading: true, filtering: false, error: '' };
    let remote = { sessionId: '', repositoryPath: '', baseBranch: '', authorIds: [], authorKeyword: '', commitHash: '' };
    let local = defaultLocal();
    let uiSaveTimer;
    let filterTimer;
    let filterRevision = 0;
    let appliedFilterRevision = 0;
    let contextMenu;

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'state') {
        const sessionChanged = remote.sessionId !== message.session.id;
        model = { snapshot: message.snapshot, visibleFileKeys: message.visibleFileKeys || [], repositories: message.repositories || [], session: message.session, sessions: message.sessions || [], loading: false, filtering: false, error: '' };
        const repo = message.snapshot.repository;
        const config = message.session.config || {};
        remote.sessionId = message.session.id;
        remote.repositoryPath = config.repositoryPath || repo.path;
        remote.baseBranch = repo.baseBranch;
        remote.authorIds = message.snapshot.activeAuthorIds || [];
        remote.authorKeyword = message.snapshot.activeAuthorKeyword || '';
        remote.commitHash = message.snapshot.activeCommit || '';
        if (sessionChanged) local = { ...defaultLocal(), ...(config.ui || {}), collapsedDirectories: {} };
        render();
      } else if (message.type === 'filtered') {
        if (message.sessionId !== remote.sessionId || Number(message.revision || 0) < appliedFilterRevision) return;
        appliedFilterRevision = Number(message.revision || 0);
        model.visibleFileKeys = message.visibleFileKeys || [];
        model.filtering = false;
        renderResults();
      } else if (message.type === 'error') {
        model.loading = false;
        model.filtering = false;
        model.error = message.message || 'Unable to load the Git diff.';
        render();
      }
    });

    function postRefresh() {
      hideContextMenu();
      model.loading = true;
      model.filtering = false;
      render();
      vscode.postMessage({ type: 'refresh', request: remote });
    }

    function defaultLocal() {
      return { query: '', scope: 'all', status: 'all', extension: 'all', glob: '', excludeDirectories: '', caseSensitive: false, regex: false, wholeWord: false, collapsedDirectories: {} };
    }

    function sessionUi() {
      return { query: local.query, scope: local.scope, status: local.status, extension: local.extension, glob: local.glob, excludeDirectories: local.excludeDirectories, caseSensitive: local.caseSensitive, regex: local.regex, wholeWord: local.wholeWord };
    }

    function saveSessionUi() {
      const sessionId = remote.sessionId;
      const ui = sessionUi();
      if (!sessionId) return;
      clearTimeout(uiSaveTimer);
      uiSaveTimer = setTimeout(() => vscode.postMessage({ type: 'saveSession', sessionId, ui }), 180);
    }

    function requestFilter() {
      const revision = ++filterRevision;
      clearTimeout(filterTimer);
      model.filtering = true;
      renderResults();
      filterTimer = setTimeout(() => vscode.postMessage({
        type: 'filter',
        sessionId: remote.sessionId,
        ui: sessionUi(),
        revision,
      }), 35);
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function option(value, label, selected) {
      const node = element('option', '', label);
      node.value = value;
      node.selected = selected;
      return node;
    }

    function field(labelText, control, extraClass, helpText) {
      const wrapper = element('div', 'field' + (extraClass ? ' ' + extraClass : ''));
      const label = element('label', '', labelText);
      if (!helpText) {
        wrapper.append(label, control);
        return wrapper;
      }
      const labelRow = element('div', 'field-label');
      const helpButton = element('button', 'help-button', '?');
      helpButton.title = helpText;
      helpButton.setAttribute('aria-label', 'Help for ' + labelText);
      helpButton.setAttribute('aria-expanded', 'false');
      const helpDetails = element('div', 'field-help', helpText);
      helpDetails.hidden = true;
      helpButton.addEventListener('click', () => {
        const expanded = helpButton.getAttribute('aria-expanded') === 'true';
        helpButton.setAttribute('aria-expanded', String(!expanded));
        helpDetails.hidden = expanded;
      });
      labelRow.append(label, helpButton);
      wrapper.append(labelRow, control, helpDetails);
      return wrapper;
    }

    function selectBase(snapshot) {
      const select = element('select');
      const branches = [...new Set([snapshot.repository.baseBranch, ...snapshot.repository.branches])];
      branches.forEach((branch) => select.append(option(branch, branch, branch === remote.baseBranch)));
      select.addEventListener('change', () => { remote.baseBranch = select.value; remote.commitHash = ''; postRefresh(); });
      return select;
    }

    function selectRepository() {
      const select = element('select');
      model.repositories.forEach((repository) => select.append(option(repository.path, repository.name, repository.path === remote.repositoryPath)));
      select.addEventListener('change', () => { remote.repositoryPath = select.value; remote.baseBranch = ''; remote.authorIds = []; remote.authorKeyword = ''; remote.commitHash = ''; postRefresh(); });
      return select;
    }

    function sessionControl() {
      const control = element('div', 'session-control');
      const select = element('select');
      model.sessions.forEach((session) => select.append(option(session.id, session.name, session.id === remote.sessionId)));
      select.setAttribute('aria-label', 'Saved diff session');
      select.addEventListener('change', () => {
        const previousId = remote.sessionId;
        const previousUi = sessionUi();
        if (previousId) vscode.postMessage({ type: 'saveSession', sessionId: previousId, ui: previousUi });
        remote.sessionId = select.value;
        vscode.postMessage({ type: 'switchSession', sessionId: select.value });
      });
      const create = element('button', 'session-action', '+');
      create.title = 'New session'; create.setAttribute('aria-label', 'Create session');
      create.addEventListener('click', () => vscode.postMessage({ type: 'createSession', sessionId: remote.sessionId }));
      const rename = element('button', 'session-action', '✎');
      rename.title = 'Rename session'; rename.setAttribute('aria-label', 'Rename session');
      rename.addEventListener('click', () => vscode.postMessage({ type: 'renameSession', sessionId: remote.sessionId }));
      const remove = element('button', 'session-action', '×');
      remove.title = 'Delete session'; remove.setAttribute('aria-label', 'Delete session');
      remove.addEventListener('click', () => vscode.postMessage({ type: 'deleteSession', sessionId: remote.sessionId }));
      control.append(select, create, rename, remove);
      return control;
    }

    function authorKeywordControl() {
      const input = element('input', 'author-keyword');
      input.value = remote.authorKeyword;
      input.placeholder = 'Name or email contains…';
      input.title = 'Press Enter to apply the author filter';
      input.setAttribute('aria-label', 'Filter diff by commit author keyword');
      input.disabled = Boolean(remote.commitHash);
      input.addEventListener('input', () => {
        remote.authorKeyword = input.value;
        remote.commitHash = '';
      });
      input.addEventListener('change', postRefresh);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') postRefresh();
      });
      return input;
    }

    function selectCommit(snapshot) {
      const select = element('select');
      select.append(option('', 'All branch commits', !remote.commitHash));
      snapshot.commits.forEach((commit) => {
        const author = commit.authorName || 'Unknown author';
        const title = commit.shortHash + ' · ' + author + ' · ' + (commit.subject || '(no subject)');
        select.append(option(commit.hash, title, commit.hash === remote.commitHash));
      });
      select.disabled = remote.authorIds.length > 0 || Boolean(remote.authorKeyword);
      select.addEventListener('change', () => { remote.commitHash = select.value; remote.authorIds = []; remote.authorKeyword = ''; postRefresh(); });
      return select;
    }

    function inputControl(value, placeholder, callback) {
      const input = element('input');
      input.value = value;
      input.placeholder = placeholder;
      input.addEventListener('input', () => { callback(input.value); requestFilter(); saveSessionUi(); });
      return input;
    }

    function excludePathsControl() {
      const terms = exclusionTerms();
      const editor = element('div', 'exclude-editor');
      if (terms.length) {
        const summary = element('div', 'exclude-summary');
        summary.append(element('span', '', terms.length + (terms.length === 1 ? ' path excluded' : ' paths excluded')));
        const clear = element('button', 'exclude-clear', 'Clear all');
        clear.title = 'Remove all excluded paths';
        clear.addEventListener('click', () => setExclusionTerms([]));
        summary.append(clear); editor.append(summary);
        const list = element('div', 'exclude-list');
        terms.forEach((term, index) => {
          const row = element('div', 'exclude-entry');
          const input = element('input');
          input.value = term;
          input.title = term;
          input.setAttribute('aria-label', 'Edit excluded path ' + term);
          input.addEventListener('change', () => {
            const updated = terms.slice();
            updated[index] = input.value;
            setExclusionTerms(updated);
          });
          input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') input.blur();
            if (event.key === 'Escape') { input.value = term; input.blur(); }
          });
          const remove = element('button', 'exclude-remove', '×');
          remove.title = 'Remove ' + term;
          remove.setAttribute('aria-label', 'Remove excluded path ' + term);
          remove.addEventListener('click', () => setExclusionTerms(terms.filter((_value, itemIndex) => itemIndex !== index)));
          row.append(input, remove); list.append(row);
        });
        editor.append(list);
      }
      const add = element('div', 'exclude-add');
      const input = element('input');
      input.placeholder = 'Add file, folder, or glob…';
      input.setAttribute('aria-label', 'Add excluded path');
      const commit = () => {
        const additions = input.value.split(',').map(normalizeExclusion).filter(Boolean);
        if (additions.length) setExclusionTerms([...terms, ...additions]);
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(); }
      });
      const addButton = element('button', '', '+');
      addButton.title = 'Add excluded path'; addButton.setAttribute('aria-label', 'Add excluded path');
      addButton.addEventListener('click', commit);
      add.append(input, addButton); editor.append(add);
      return editor;
    }

    function exclusionTerms() {
      return [...new Set(String(local.excludeDirectories || '').split(',').map(normalizeExclusion).filter(Boolean))];
    }

    function normalizeExclusion(value) {
      let normalized = String(value || '').trim().replaceAll(String.fromCharCode(92), '/');
      while (normalized.startsWith('./')) normalized = normalized.slice(2);
      while (normalized.startsWith('/')) normalized = normalized.slice(1);
      while (normalized.endsWith('/')) normalized = normalized.slice(0, -1);
      return normalized;
    }

    function setExclusionTerms(values) {
      const unique = [];
      values.map(normalizeExclusion).filter(Boolean).forEach((value) => {
        if (!unique.includes(value)) unique.push(value);
      });
      local.excludeDirectories = unique.join(', ');
      render();
      requestFilter();
      saveSessionUi();
    }

    function addExcludedPath(path) {
      const normalized = normalizeExclusion(path);
      if (!normalized) return;
      setExclusionTerms([...exclusionTerms(), normalized]);
    }

    function checkbox(labelText, value, callback) {
      const label = element('label', 'check');
      const input = element('input');
      input.type = 'checkbox';
      input.checked = value;
      input.addEventListener('change', () => { callback(input.checked); requestFilter(); saveSessionUi(); });
      label.append(input, document.createTextNode(labelText));
      return label;
    }

    function render() {
      app.replaceChildren();
      if (model.error) {
        const error = element('div', 'error');
        error.append(element('div', '', model.error));
        const settings = element('button', '', 'Open Settings');
        settings.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
        error.append(settings);
        app.append(error);
        return;
      }
      const snapshot = model.snapshot;
      if (!snapshot) { app.append(element('div', 'empty', model.loading ? 'Loading local Git changes…' : 'No Git data available.')); return; }

      const header = element('section', 'header');
      const titleRow = element('div', 'title-row');
      const titleWrap = element('div', 'title-wrap');
      const branchContext = element('div', 'branch-context');
      branchContext.append(element('span', 'branch-ref', snapshot.repository.branch), element('span', 'branch-arrow', '→'), element('span', 'branch-ref', snapshot.repository.baseBranch));
      titleWrap.append(element('div', 'title', 'Branch Diff Explorer'), branchContext);
      const tools = element('div', 'header-tools');
      const refresh = element('button', 'icon', '↻');
      refresh.title = 'Refresh'; refresh.setAttribute('aria-label', 'Refresh Git diff'); refresh.addEventListener('click', postRefresh);
      const exportDiffs = element('button', 'icon', '⇩');
      exportDiffs.title = 'Export filtered diffs'; exportDiffs.setAttribute('aria-label', 'Export filtered diffs');
      exportDiffs.addEventListener('click', () => {
        const files = visibleFiles();
        if (!files.length) return;
        vscode.postMessage({ type: 'exportDiffs', files: files.map((file) => ({ path: file.path, source: file.source })) });
      });
      const mcp = element('button', 'mcp-action', 'MCP Setup');
      mcp.title = 'Configure AI access through MCP'; mcp.setAttribute('aria-label', 'Configure Branch Diff MCP');
      mcp.addEventListener('click', () => vscode.postMessage({ type: 'showMcpSetup' }));
      const panel = element('button', 'icon', '↗');
      panel.title = 'Open in editor panel'; panel.setAttribute('aria-label', 'Open in editor panel'); panel.addEventListener('click', () => vscode.postMessage({ type: 'openPanel', request: remote }));
      tools.append(mcp, element('span', 'header-spacer'), exportDiffs, refresh, panel);
      titleRow.append(titleWrap); header.append(titleRow, tools); app.append(header);

      const controls = element('section', 'controls');
      const primary = element('div', 'grid');
      primary.append(field('Session', sessionControl(), 'wide'));
      if (model.repositories.length > 1) primary.append(field('Workspace folder', selectRepository()));
      primary.append(field('Compare with', selectBase(snapshot)));
      primary.append(field('Single commit', selectCommit(snapshot)));
      primary.append(field('Author contains', authorKeywordControl(), 'wide', 'Case-insensitive contains match against commit author name or email. Only committed changes can match because staged and unstaged work has no commit author. Press Enter to apply. Author mode disables Single commit and Git state.'));
      primary.append(field('Search changed lines', inputControl(local.query, 'Search, or file:Button', (value) => local.query = value), 'wide'));
      controls.append(primary); app.append(controls);

      const filters = element('section', 'filterbar');
      const filterGrid = element('div', 'grid');
      const source = element('select');
      [['all', 'All Git states'], ['committed', 'Committed'], ['staged', 'Staged'], ['unstaged', 'Unstaged']].forEach(([value, label]) => source.append(option(value, label, local.scope === value)));
      source.disabled = Boolean(remote.commitHash || remote.authorIds.length || remote.authorKeyword); source.addEventListener('change', () => { local.scope = source.value; requestFilter(); saveSessionUi(); });
      filterGrid.append(field('Git state', source));
      const status = element('select');
      [['all', 'All changes'], ['added', 'Added'], ['modified', 'Modified'], ['deleted', 'Deleted'], ['renamed', 'Renamed']].forEach(([value, label]) => status.append(option(value, label, local.status === value)));
      status.addEventListener('change', () => { local.status = status.value; requestFilter(); saveSessionUi(); });
      filterGrid.append(field('Change kind', status));
      const extension = element('select');
      extension.append(option('all', 'All file types', local.extension === 'all'));
      fileExtensions(snapshot.files).forEach((type) => extension.append(option(type, type, local.extension === type)));
      extension.addEventListener('change', () => { local.extension = extension.value; requestFilter(); saveSessionUi(); });
      filterGrid.append(field('File type', extension));
      filterGrid.append(field('Glob', inputControl(local.glob, '**/*.ts, !**/test/**', (value) => local.glob = value), '', 'Comma-separated repository-relative patterns. * matches within one folder, ** spans folders, ? matches one character, and ! excludes. Examples: **/*.ts · **/*.c, **/*.h · **/*.ts, !**/*.test.ts'));
      filterGrid.append(field('Exclude paths', excludePathsControl(), 'wide', 'Exclude repository-relative files, folders, or glob patterns. A simple name matches that file or folder name anywhere. Right-click a tree item to add it here. Entries are saved with this session and can be edited or removed individually.'));
      filters.append(filterGrid);
      const options = element('div', 'option-row');
      options.append(checkbox('Match case', local.caseSensitive, (value) => local.caseSensitive = value));
      options.append(checkbox('Use regex', local.regex, (value) => local.regex = value));
      options.append(checkbox('Whole word', local.wholeWord, (value) => local.wholeWord = value));
      filters.append(options); app.append(filters);

      const results = element('section'); results.id = 'results'; app.append(results);
      renderResults();
    }

    function renderResults() {
      const container = document.getElementById('results');
      if (!container || !model.snapshot) return;
      container.replaceChildren();
      const files = visibleFiles();
      const summary = element('div', 'summary');
      const left = element('span'); left.append(element('strong', '', formatCount(model.snapshot.totals.files)), document.createTextNode(' files'));
      if (files.length !== model.snapshot.files.length) left.append(element('span', 'summary-filtered', formatCount(files.length) + ' shown'));
      const right = element('span', 'summary-totals');
      if (model.loading) right.append(element('span', 'loading', 'Refreshing…'));
      else if (model.filtering) right.append(element('span', 'filter-spinner'), element('span', 'loading', local.query.trim() ? 'Searching…' : 'Filtering…'));
      else right.append(element('span', 'plus', '+' + formatCount(model.snapshot.totals.additions)), element('span', 'minus', '−' + formatCount(model.snapshot.totals.deletions)));
      summary.append(left, right); container.append(summary);
      if (model.snapshot.notice) container.append(element('div', 'notice', model.snapshot.notice));
      if (model.snapshot.reviewer.warning) container.append(element('div', 'notice', model.snapshot.reviewer.warning));
      const review = renderReview(model.snapshot);
      if (review) container.append(review);
      if (!files.length) {
        container.append(element('div', 'empty', model.snapshot.files.length ? 'No changed files match the current filters.' : 'No branch, staged, or unstaged changes were found.'));
        return;
      }
      const tree = element('div', 'tree');
      renderTreeRoot(tree, buildDirectoryTree(files));
      container.append(tree);
    }

    function visibleFiles() {
      if (!model.snapshot) return [];
      const keys = new Set(model.visibleFileKeys || []);
      return model.snapshot.files.filter((file) => keys.has(file.source + String.fromCharCode(0) + file.path));
    }

    function buildDirectoryTree(files) {
      const root = { files: [], directories: new Map() };
      files.forEach((file) => {
        const parts = file.path.split('/').filter(Boolean);
        let node = root;
        parts.slice(0, -1).forEach((part) => {
          if (!node.directories.has(part)) node.directories.set(part, { files: [], directories: new Map() });
          node = node.directories.get(part);
        });
        node.files.push(file);
      });
      return root;
    }

    function renderTreeRoot(parent, node) {
      [...node.directories.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([name, child]) => {
        renderDirectory(parent, child, name, name, 0);
      });
      node.files.sort((left, right) => left.path.localeCompare(right.path)).forEach((file) => parent.append(renderFile(file, 0)));
    }

    function renderDirectory(parent, node, name, directoryPath, depth) {
      const directory = element('section', 'folder');
      const key = directoryPath || '/';
      const collapsed = Boolean(local.collapsedDirectories[key]);
      const title = element('button', 'folder-title');
      title.style.paddingLeft = (8 + depth * 14) + 'px';
      title.setAttribute('aria-expanded', String(!collapsed));
      title.append(element('span', 'folder-chevron', collapsed ? '›' : '⌄'), element('span', '', name), element('span', 'folder-count', String(directoryEntryCount(node))));
      title.title = collapsed ? 'Expand ' + name : 'Collapse ' + name;
      title.addEventListener('click', () => { local.collapsedDirectories[key] = !collapsed; renderResults(); });
      title.addEventListener('contextmenu', (event) => showFolderContextMenu(event, directoryPath, name));
      directory.append(title);
      if (!collapsed) {
        [...node.directories.entries()].sort(([left], [right]) => left.localeCompare(right)).forEach(([childName, child]) => {
          const childPath = directoryPath ? directoryPath + '/' + childName : childName;
          renderDirectory(directory, child, childName, childPath, depth + 1);
        });
        node.files.sort((left, right) => left.path.localeCompare(right.path)).forEach((file) => directory.append(renderFile(file, depth + 1)));
      }
      parent.append(directory);
    }

    function directoryEntryCount(node) {
      let count = node.files.length;
      node.directories.forEach((child) => { count += directoryEntryCount(child); });
      return count;
    }

    function renderFile(file, depth) {
      const row = element('div', 'file-row');
      row.addEventListener('contextmenu', (event) => showFileContextMenu(event, file));
      const button = element('button', 'file');
      button.style.paddingLeft = (10 + depth * 14) + 'px';
      button.title = 'Open diff for ' + file.path;
      button.addEventListener('click', () => vscode.postMessage({ type: 'openFile', path: file.path, source: file.source }));
      const main = element('div', 'file-main');
      const status = element('span', 'badge ' + file.status, statusLetter(file.status)); status.title = file.status;
      const slash = file.path.lastIndexOf('/');
      const name = slash === -1 ? file.path : file.path.slice(slash + 1);
      const path = element('span', 'path', name);
      main.append(status, path);
      const findings = findingsForFile(file.path);
      if (findings.length) main.append(element('span', 'severity ' + highestSeverity(findings), String(findings.length)));
      button.append(main);
      const stats = element('div', 'file-stats');
      stats.title = file.additions + ' added lines, ' + file.deletions + ' deleted lines';
      stats.append(element('span', 'plus', '+' + file.additions), element('span', 'minus', '−' + file.deletions));
      row.append(button, stats);
      return row;
    }

    function showFileContextMenu(event, file) {
      event.preventDefault();
      hideContextMenu();
      const menu = element('div', 'context-menu');
      const addAction = (label, action) => {
        const item = element('button', '', label);
        item.addEventListener('click', () => { hideContextMenu(); action(); });
        menu.append(item);
      };
      const separator = () => menu.append(element('div', 'menu-separator'));
      addAction('Open file', () => vscode.postMessage({ type: 'openPath', path: file.path }));
      addAction('Open side-by-side diff', () => vscode.postMessage({ type: 'openFile', path: file.path, source: file.source }));
      addAction('Reveal in file manager', () => vscode.postMessage({ type: 'revealPath', path: file.path }));
      addAction(model.snapshot.favorites.includes(file.path) ? 'Remove from favorites' : 'Add to favorites', () => vscode.postMessage({ type: 'toggleFavorite', path: file.path }));
      addAction(model.snapshot.reviewedFiles.includes(file.path) ? 'Mark as not reviewed' : 'Mark as reviewed', () => vscode.postMessage({ type: 'toggleReviewed', path: file.path }));
      addAction('Exclude this file', () => addExcludedPath(file.path));
      separator();
      addAction('Copy relative path', () => vscode.postMessage({ type: 'copyPath', path: file.path, copyKind: 'relative' }));
      addAction('Copy absolute path', () => vscode.postMessage({ type: 'copyPath', path: file.path, copyKind: 'absolute' }));
      addAction('Copy file name', () => vscode.postMessage({ type: 'copyPath', path: file.path, copyKind: 'name' }));
      addAction('Copy file URI', () => vscode.postMessage({ type: 'copyPath', path: file.path, copyKind: 'uri' }));
      placeContextMenu(menu, event);
      contextMenu = menu;
    }

    function showFolderContextMenu(event, path, name) {
      event.preventDefault();
      hideContextMenu();
      const menu = element('div', 'context-menu');
      const addAction = (label, action) => {
        const item = element('button', '', label);
        item.addEventListener('click', () => { hideContextMenu(); action(); });
        menu.append(item);
      };
      const separator = () => menu.append(element('div', 'menu-separator'));
      addAction('Reveal in Explorer', () => vscode.postMessage({ type: 'revealInExplorer', path }));
      addAction('Reveal in file manager', () => vscode.postMessage({ type: 'revealPath', path }));
      addAction('Find in folder', () => vscode.postMessage({ type: 'findInFolder', path }));
      addAction('Exclude this folder', () => addExcludedPath(path));
      separator();
      addAction('Copy relative path', () => vscode.postMessage({ type: 'copyPath', path, copyKind: 'relative' }));
      addAction('Copy absolute path', () => vscode.postMessage({ type: 'copyPath', path, copyKind: 'absolute' }));
      addAction('Copy folder name', () => vscode.postMessage({ type: 'copyPath', path, copyKind: 'name' }));
      addAction('Copy folder URI', () => vscode.postMessage({ type: 'copyPath', path, copyKind: 'uri' }));
      menu.setAttribute('aria-label', 'Folder actions for ' + name);
      placeContextMenu(menu, event);
      contextMenu = menu;
    }

    function placeContextMenu(menu, event) {
      menu.style.visibility = 'hidden';
      document.body.append(menu);
      menu.style.left = Math.max(4, Math.min(event.clientX, window.innerWidth - menu.offsetWidth - 4)) + 'px';
      menu.style.top = Math.max(4, Math.min(event.clientY, window.innerHeight - menu.offsetHeight - 4)) + 'px';
      menu.style.visibility = 'visible';
    }

    function hideContextMenu() {
      if (contextMenu) contextMenu.remove();
      contextMenu = undefined;
    }

    function statusLetter(status) { return ({ added: 'A', modified: 'M', deleted: 'D', renamed: 'R', unknown: '?' })[status] || '?'; }
    function formatCount(value) { return Number(value || 0).toLocaleString(); }

    function fileExtensions(files) {
      return [...new Set(files.map((file) => { const match = /\\.[^/.]+$/.exec(file.path); return match ? match[0].toLowerCase() : '(no extension)'; }))].sort();
    }

    function findingsForFile(path) { return model.snapshot.reviewer.findings.filter((finding) => finding.file === path); }

    function highestSeverity(findings) {
      const priority = { critical: 5, high: 4, medium: 3, low: 2, nit: 1 };
      return findings.slice().sort((left, right) => priority[right.severity] - priority[left.severity])[0].severity;
    }

    function renderReview(snapshot) {
      const reviewer = snapshot.reviewer;
      if (!reviewer.findings.length && !reviewer.absences.length && !reviewer.briefing) return null;
      const section = element('section', 'review');
      const reviewedCount = snapshot.reviewedFiles.length;
      section.append(element('div', 'review-heading', 'Reviewer cockpit · ' + reviewer.findings.length + ' findings · ' + reviewedCount + ' files reviewed'));
      if (reviewer.briefing) {
        const card = element('div', 'briefing');
        if (reviewer.briefing.intent) card.append(element('div', 'briefing-intent', reviewer.briefing.intent));
        if (reviewer.briefing.summary.length) {
          const list = element('ul'); reviewer.briefing.summary.forEach((item) => list.append(element('li', '', item))); card.append(list);
        }
        if (reviewer.briefing.reviewOrder.length) {
          const list = element('ul');
          reviewer.briefing.reviewOrder.forEach((item) => {
            const row = element('li'); const jump = element('button', '', item.path); jump.addEventListener('click', () => vscode.postMessage({ type: 'openPath', path: item.path }));
            row.append(jump, document.createTextNode(item.reason ? ' — ' + item.reason : '')); list.append(row);
          });
          card.append(list);
        }
        if (reviewer.briefing.skipList.length) card.append(element('div', 'finding-meta', 'Skippable: ' + reviewer.briefing.skipList.join(', ')));
        section.append(card);
      }
      reviewer.findings.forEach((finding) => section.append(renderFinding(finding, snapshot.triage[finding.id], false)));
      reviewer.absences.forEach((absence) => section.append(renderFinding(absence, snapshot.triage[absence.id], true)));
      return section;
    }

    function renderFinding(finding, decision, absence) {
      const card = element('article', 'finding ' + finding.severity + (decision ? ' triaged' : ''));
      const title = element('div', 'finding-title', (absence ? 'Missing: ' : '') + finding.title || finding.subject);
      if (absence) title.textContent = 'Missing: ' + finding.subject;
      card.append(title);
      const details = [finding.source || finding.kind, finding.file ? finding.file + (finding.line ? ':' + finding.line : '') : '', finding.message || finding.ask].filter(Boolean).join(' · ');
      if (details) card.append(element('div', 'finding-meta', details));
      const actions = element('div', 'finding-actions');
      if (finding.file) {
        const jump = element('button', '', 'Open'); jump.addEventListener('click', () => vscode.postMessage({ type: 'openPath', path: finding.file, line: finding.line })); actions.append(jump);
      }
      const agree = element('button', '', decision === 'agreed' ? 'Agreed ✓' : 'Agree');
      agree.addEventListener('click', () => vscode.postMessage({ type: 'triage', findingId: finding.id, decision: 'agreed' }));
      const skip = element('button', '', decision === 'skipped' ? 'Skipped ✓' : 'Skip');
      skip.addEventListener('click', () => vscode.postMessage({ type: 'triage', findingId: finding.id, decision: 'skipped' }));
      actions.append(agree, skip); card.append(actions); return card;
    }

    vscode.postMessage({ type: 'ready' });
    document.addEventListener('pointerdown', (event) => { if (contextMenu && !contextMenu.contains(event.target)) hideContextMenu(); });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hideContextMenu(); });
    window.addEventListener('blur', hideContextMenu);
  </script>
</body>
</html>`;
}

function randomNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return nonce;
}
