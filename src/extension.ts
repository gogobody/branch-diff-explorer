import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { diffExportContent, diffExportRelativePath } from './export';
import { visibleFileKeys as filteredFileKeys, type SessionUiConfig } from './filter';
import { GitRepository, revertPatchWithDiagnostics, type GitRunOptions } from './git';
import type { ExplorerSession, McpRepositorySettings, McpState } from './mcp-state';
import { createWebviewHtml } from './webview';
import type { ChangedFile, DiffSnapshot, FindingSeverity, SnapshotRequest } from './types';

const CONTENT_SCHEME = 'branch-diff-explorer-content';
const SESSIONS_STORAGE_KEY = 'branchDiffExplorer.sessions.v1';
const MCP_RUNTIME_FILE = 'branch-diff-explorer-mcp.js';
const MCP_STATE_FILE = 'branch-diff-explorer-mcp-state.json';
const execFileAsync = promisify(execFile);

interface RepositoryChoice {
  path: string;
  name: string;
}

interface ViewRequest extends SnapshotRequest {
  repositoryPath?: string;
  sessionId?: string;
}

interface ExplorerViewState {
  snapshot: DiffSnapshot;
  session: ExplorerSession;
  sessions: ExplorerSession[];
  visibleFileKeys: string[];
}

interface ViewMessage {
  type: 'ready' | 'refresh' | 'filter' | 'switchSession' | 'createSession' | 'renameSession' | 'deleteSession' | 'saveSession' | 'openFile' | 'openPanel' | 'exportDiffs' | 'showMcpSetup' | 'openSettings' | 'openPath' | 'copyPath' | 'revealPath' | 'revealInExplorer' | 'findInFolder' | 'toggleFavorite' | 'toggleReviewed' | 'triage' | 'info';
  request?: ViewRequest;
  sessionId?: string;
  ui?: SessionUiConfig;
  path?: string;
  source?: ChangedFile['source'];
  files?: Array<{ path: string; source: ChangedFile['source'] }>;
  line?: number;
  findingId?: string;
  decision?: 'agreed' | 'skipped';
  copyKind?: 'absolute' | 'relative' | 'name' | 'uri';
  revision?: number;
}

class VirtualGitContent implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, { value: string; target: vscode.Uri }>();

  put(value: string, target: vscode.Uri): vscode.Uri {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.contents.set(id, { value, target });
    // Keep the source file extension so syntax highlighting works in both diff panes.
    return vscode.Uri.from({ scheme: CONTENT_SCHEME, path: `/${id}/${basename(target.path) || 'content.txt'}` });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(this.id(uri))?.value ?? '';
  }

  target(uri: vscode.Uri): vscode.Uri | undefined {
    return this.contents.get(this.id(uri))?.target;
  }

  private id(uri: vscode.Uri): string {
    return uri.path.split('/')[1] ?? '';
  }
}

class ExplorerWebview implements vscode.Disposable {
  private snapshot?: DiffSnapshot;
  private request: ViewRequest = {};
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly controller: ExplorerController,
    private readonly webview: vscode.Webview,
  ) {
    webview.options = { enableScripts: true, localResourceRoots: [] };
    webview.html = createWebviewHtml(webview);
    this.disposables.push(webview.onDidReceiveMessage((message: ViewMessage) => this.receive(message)));
  }

  async refresh(request?: ViewRequest): Promise<void> {
    if (request) this.request = request;
    try {
      const state = await this.controller.snapshot(this.request);
      this.snapshot = state.snapshot;
      this.request = { ...state.session.config, sessionId: state.session.id };
      await this.webview.postMessage({
        type: 'state',
        snapshot: state.snapshot,
        visibleFileKeys: state.visibleFileKeys,
        repositories: await this.controller.repositories(),
        session: state.session,
        sessions: state.sessions,
      });
    } catch (error) {
      const message = errorMessage(error);
      await this.webview.postMessage({ type: 'error', message });
      void this.controller.showError(message);
    }
  }

  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }

  private async receive(message: ViewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.refresh(message.request);
        return;
      case 'filter':
        if (this.snapshot && message.ui) {
          await this.webview.postMessage({
            type: 'filtered',
            visibleFileKeys: this.controller.visibleFileKeys(this.snapshot, message.ui),
            revision: message.revision,
            sessionId: message.sessionId,
          });
        }
        return;
      case 'switchSession':
        if (message.sessionId) await this.refresh({ sessionId: message.sessionId });
        return;
      case 'createSession': {
        const session = await this.controller.createSession(this.request.sessionId);
        if (session) await this.refresh({ sessionId: session.id });
        return;
      }
      case 'renameSession':
        if (this.request.sessionId) await this.controller.renameSession(this.request.sessionId);
        await this.refresh();
        return;
      case 'deleteSession': {
        const fallback = this.request.sessionId ? await this.controller.deleteSession(this.request.sessionId) : undefined;
        if (fallback) await this.refresh({ sessionId: fallback.id });
        return;
      }
      case 'saveSession':
        if (message.sessionId && message.ui) await this.controller.saveSessionUi(message.sessionId, message.ui);
        return;
      case 'openFile':
        if (!this.snapshot || !message.path || !message.source) return;
        await this.controller.openFile(this.snapshot, message.path, message.source);
        return;
      case 'openPanel':
        await this.controller.openPanel(this.request);
        return;
      case 'exportDiffs':
        if (!this.snapshot || !message.files?.length) return;
        try {
          await this.controller.exportDiffs(this.snapshot, message.files);
        } catch (error) {
          void vscode.window.showErrorMessage(`Branch Diff Explorer: Unable to export diffs: ${errorMessage(error)}`);
        }
        return;
      case 'showMcpSetup':
        await this.controller.showMcpSetup();
        return;
      case 'openSettings':
        await this.controller.openSettings();
        return;
      case 'openPath':
        if (message.path) await this.controller.openPath(this.snapshot?.repository.path, message.path, message.line);
        return;
      case 'copyPath':
        if (message.path && message.copyKind) await this.controller.copyPath(this.snapshot?.repository.path, message.path, message.copyKind);
        return;
      case 'revealPath':
        if (message.path) await this.controller.revealPath(this.snapshot?.repository.path, message.path);
        return;
      case 'revealInExplorer':
        if (message.path) await this.controller.revealInExplorer(this.snapshot?.repository.path, message.path);
        return;
      case 'findInFolder':
        if (message.path) await this.controller.findInFolder(this.snapshot?.repository.path, message.path);
        return;
      case 'toggleFavorite':
        if (this.snapshot && message.path) {
          await this.controller.toggleFavorite(this.snapshot, message.path);
          await this.refresh();
        }
        return;
      case 'toggleReviewed':
        if (this.snapshot && message.path) {
          await this.controller.toggleReviewed(this.snapshot, message.path);
          await this.refresh();
        }
        return;
      case 'triage':
        if (this.snapshot && message.findingId && message.decision) {
          await this.controller.triage(this.snapshot, message.findingId, message.decision);
          await this.refresh();
        }
        return;
      case 'info':
        void vscode.window.showInformationMessage('Branch Diff Explorer uses only local Git data.');
        return;
    }
  }
}

class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private client?: ExplorerWebview;

  constructor(private readonly controller: ExplorerController) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.client?.dispose();
    this.client = new ExplorerWebview(this.controller, view.webview);
    void this.client.refresh();
    view.onDidDispose(() => {
      this.client?.dispose();
      this.client = undefined;
      this.view = undefined;
    });
  }

  async show(): Promise<void> {
    await vscode.commands.executeCommand('workbench.view.extension.branchDiffExplorer');
    this.view?.show?.(true);
    await this.client?.refresh();
  }

  refresh(): void {
    void this.client?.refresh();
  }
}

class ExplorerController implements vscode.Disposable {
  private readonly content = new VirtualGitContent();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly clients = new Set<ExplorerWebview>();
  private readonly sidebar: SidebarProvider;
  private readonly decorations: Record<FindingSeverity, vscode.TextEditorDecorationType>;
  private readonly mcpRuntimeUri: vscode.Uri;
  private readonly mcpStateUri: vscode.Uri;
  private readonly mcpReady: Promise<void>;
  private lastSnapshot?: DiffSnapshot;
  private refreshTimer?: NodeJS.Timeout;
  private activeSessionId?: string;
  private mcpInitializationError?: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.sidebar = new SidebarProvider(this);
    this.mcpRuntimeUri = vscode.Uri.joinPath(context.globalStorageUri, MCP_RUNTIME_FILE);
    this.mcpStateUri = vscode.Uri.joinPath(context.storageUri ?? context.globalStorageUri, MCP_STATE_FILE);
    this.mcpReady = this.prepareMcpRuntime();
    void this.mcpReady
      .then(() => this.syncMcpState(this.sessions()))
      .catch((error) => { this.mcpInitializationError = errorMessage(error); });
    const gitWatcher = vscode.workspace.createFileSystemWatcher('**/.git/**');
    const reviewerWatcher = vscode.workspace.createFileSystemWatcher('**/.diffly/findings.json');
    this.decorations = {
      critical: vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(241, 76, 76, 0.24)', overviewRulerColor: '#f14c4c', overviewRulerLane: vscode.OverviewRulerLane.Right }),
      high: vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(255, 136, 0, 0.20)', overviewRulerColor: '#ff8800', overviewRulerLane: vscode.OverviewRulerLane.Right }),
      medium: vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(228, 198, 82, 0.18)', overviewRulerColor: '#e4c652', overviewRulerLane: vscode.OverviewRulerLane.Right }),
      low: vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(55, 148, 255, 0.16)', overviewRulerColor: '#3794ff', overviewRulerLane: vscode.OverviewRulerLane.Right }),
      nit: vscode.window.createTextEditorDecorationType({ backgroundColor: 'rgba(128, 128, 128, 0.14)', overviewRulerColor: '#858585', overviewRulerLane: vscode.OverviewRulerLane.Right }),
    };
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(CONTENT_SCHEME, this.content),
      vscode.languages.registerDefinitionProvider({ scheme: CONTENT_SCHEME }, {
        provideDefinition: (document, position) => this.forwardNavigation('vscode.executeDefinitionProvider', document, position),
      }),
      vscode.languages.registerDeclarationProvider({ scheme: CONTENT_SCHEME }, {
        provideDeclaration: (document, position) => this.forwardNavigation('vscode.executeDeclarationProvider', document, position),
      }),
      vscode.languages.registerTypeDefinitionProvider({ scheme: CONTENT_SCHEME }, {
        provideTypeDefinition: (document, position) => this.forwardNavigation('vscode.executeTypeDefinitionProvider', document, position),
      }),
      vscode.languages.registerImplementationProvider({ scheme: CONTENT_SCHEME }, {
        provideImplementation: (document, position) => this.forwardNavigation('vscode.executeImplementationProvider', document, position),
      }),
      vscode.window.registerWebviewViewProvider('branchDiffExplorer.view', this.sidebar),
      vscode.commands.registerCommand('branchDiffExplorer.open', () => this.sidebar.show()),
      vscode.commands.registerCommand('branchDiffExplorer.openPanel', () => this.openPanel()),
      vscode.commands.registerCommand('branchDiffExplorer.refresh', () => this.refreshAll()),
      vscode.commands.registerCommand('branchDiffExplorer.openSettings', () => this.openSettings()),
      vscode.commands.registerCommand('branchDiffExplorer.mcpSetup', () => this.showMcpSetup()),
      vscode.commands.registerCommand('branchDiffExplorer.copyCodexMcpConfig', () => this.copyCodexMcpConfig()),
      vscode.commands.registerCommand('branchDiffExplorer.copyClaudeMcpConfig', () => this.copyClaudeMcpConfig()),
      vscode.commands.registerCommand('branchDiffExplorer.testMcp', () => this.testMcp()),
      vscode.workspace.onDidSaveTextDocument(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.scheduleRefresh()),
      gitWatcher,
      gitWatcher.onDidCreate(() => this.scheduleRefresh()),
      gitWatcher.onDidChange(() => this.scheduleRefresh()),
      gitWatcher.onDidDelete(() => this.scheduleRefresh()),
      reviewerWatcher,
      reviewerWatcher.onDidCreate(() => this.scheduleRefresh()),
      reviewerWatcher.onDidChange(() => this.scheduleRefresh()),
      reviewerWatcher.onDidDelete(() => this.scheduleRefresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.decorateFindings(this.lastSnapshot)),
      ...Object.values(this.decorations),
    );
    context.subscriptions.push(this);
  }

  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    for (const disposable of this.disposables) disposable.dispose();
    for (const client of this.clients) client.dispose();
  }

  async repositories(): Promise<RepositoryChoice[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const roots = new Set<string>();
    for (const folder of workspaceFolders) {
      const options = this.gitRunOptions(folder.uri);
      if (await GitRepository.isRepository(folder.uri.fsPath, options)) {
        roots.add(await new GitRepository(folder.uri.fsPath, options).root());
      }
    }
    return [...roots].sort().map((path) => ({ path, name: vscode.workspace.asRelativePath(path, false) || path.split(/[\\/]/).pop() || path }));
  }

  async snapshot(request: ViewRequest): Promise<ExplorerViewState> {
    const sessions = this.sessions();
    const session = sessions.find((candidate) => candidate.id === request.sessionId) ?? sessions[0];
    const configured = session.config;
    const effectiveRequest: ViewRequest = {
      repositoryPath: request.repositoryPath ?? configured.repositoryPath,
      baseBranch: request.baseBranch ?? configured.baseBranch,
      authorIds: request.authorIds ?? configured.authorIds,
      authorKeyword: request.authorKeyword ?? configured.authorKeyword,
      commitHash: request.commitHash ?? configured.commitHash,
    };
    const repositories = await this.repositories();
    if (!repositories.length) {
      await vscode.commands.executeCommand('setContext', 'branchDiffExplorer.hasRepository', false);
      throw new Error('Open a folder that contains a Git repository to inspect a branch diff.');
    }
    await vscode.commands.executeCommand('setContext', 'branchDiffExplorer.hasRepository', true);
    const selected = repositories.find((repo) => repo.path === effectiveRequest.repositoryPath) ?? repositories[0];
    const configuration = vscode.workspace.getConfiguration('branchDiffExplorer', vscode.Uri.file(selected.path));
    const maxLines = configuration.get<number>('maxChangedLines', 4000);
    const storedBase = this.context.workspaceState.get<string>(`branchDiffExplorer.base:${selected.path}`);
    const gitRequest = { ...effectiveRequest, baseBranch: effectiveRequest.baseBranch || storedBase };
    const result = await new GitRepository(selected.path, this.gitRunOptions(vscode.Uri.file(selected.path))).snapshot(
      gitRequest,
      configuration.get<string>('defaultBaseBranch'),
      maxLines,
    );
    if (effectiveRequest.baseBranch && effectiveRequest.baseBranch === result.repository.baseBranch) {
      await this.context.workspaceState.update(`branchDiffExplorer.base:${selected.path}`, effectiveRequest.baseBranch);
    }
    const stateKey = this.stateKey(result);
    const enriched: DiffSnapshot = {
      ...result,
      favorites: this.context.workspaceState.get<string[]>(`${stateKey}:favorites`, []),
      reviewedFiles: this.context.workspaceState.get<string[]>(`${stateKey}:reviewed`, []),
      triage: this.context.workspaceState.get<Record<string, 'agreed' | 'skipped'>>(`${stateKey}:triage`, {}),
    };
    this.lastSnapshot = enriched;
    this.activeSessionId = session.id;
    this.decorateFindings(enriched);
    session.config = {
      ...session.config,
      repositoryPath: enriched.repository.path,
      baseBranch: enriched.repository.baseBranch,
      authorIds: enriched.activeAuthorIds,
      authorKeyword: enriched.activeAuthorKeyword,
      commitHash: enriched.activeCommit,
    };
    await this.saveSessions(sessions);
    return {
      snapshot: enriched,
      session,
      sessions,
      visibleFileKeys: this.visibleFileKeys(enriched, session.config.ui),
    };
  }

  visibleFileKeys(snapshot: DiffSnapshot, ui?: SessionUiConfig): string[] {
    return filteredFileKeys(snapshot.files, ui);
  }

  async createSession(sourceId?: string): Promise<ExplorerSession | undefined> {
    const sessions = this.sessions();
    const source = sessions.find((session) => session.id === sourceId) ?? sessions[0];
    const suggested = `Session ${sessions.length + 1}`;
    const name = await vscode.window.showInputBox({
      title: 'Create Branch Diff session',
      prompt: 'Each session keeps its own workspace folder and diff filters.',
      value: suggested,
      validateInput: (value) => value.trim() ? undefined : 'A session name is required.',
    });
    if (!name) return undefined;
    const session: ExplorerSession = {
      id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      config: {
        ...source.config,
        authorIds: source.config.authorIds ? [...source.config.authorIds] : [],
        ui: source.config.ui ? { ...source.config.ui } : {},
      },
    };
    sessions.push(session);
    await this.saveSessions(sessions);
    return session;
  }

  async renameSession(sessionId: string): Promise<void> {
    const sessions = this.sessions();
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    const name = await vscode.window.showInputBox({
      title: 'Rename Branch Diff session',
      value: session.name,
      validateInput: (value) => value.trim() ? undefined : 'A session name is required.',
    });
    if (!name || name.trim() === session.name) return;
    session.name = name.trim();
    await this.saveSessions(sessions);
  }

  async deleteSession(sessionId: string): Promise<ExplorerSession | undefined> {
    const sessions = this.sessions();
    if (sessions.length === 1) {
      void vscode.window.showInformationMessage('Branch Diff Explorer keeps one default session. Create another session before deleting this one.');
      return sessions[0];
    }
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return sessions[0];
    const choice = await vscode.window.showWarningMessage(`Delete the “${session.name}” session?`, { modal: true }, 'Delete');
    if (choice !== 'Delete') return session;
    const remaining = sessions.filter((candidate) => candidate.id !== sessionId);
    if (this.activeSessionId === sessionId) this.activeSessionId = remaining[0]?.id;
    await this.saveSessions(remaining);
    return remaining[0];
  }

  async saveSessionUi(sessionId: string, ui: SessionUiConfig): Promise<void> {
    const sessions = this.sessions();
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    session.config.ui = { ...ui };
    await this.saveSessions(sessions);
  }

  async openPanel(request: ViewRequest = {}): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'branchDiffExplorer.panel',
      'Branch Diff Explorer',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    const client = new ExplorerWebview(this, panel.webview);
    this.clients.add(client);
    panel.onDidDispose(() => {
      client.dispose();
      this.clients.delete(client);
    });
    await client.refresh(request);
  }

  async openFile(snapshot: DiffSnapshot, path: string, source: ChangedFile['source']): Promise<void> {
    const file = snapshot.files.find((candidate) => candidate.path === path && candidate.source === source);
    if (!file) return;
    const repository = new GitRepository(snapshot.repository.path, this.gitRunOptions(vscode.Uri.file(snapshot.repository.path)));
    const leftPath = file.previousPath ?? file.path;
    const leftTarget = vscode.Uri.file(resolve(snapshot.repository.path, leftPath));
    const rightTarget = vscode.Uri.file(resolve(snapshot.repository.path, file.path));
    if (source === 'author') {
      const rightContent = await this.currentContentOrEmpty(rightTarget);
      // Always invert only the selected authors' patches. In particular, a
      // file first created by one author can have later lines from another;
      // using an empty left pane in that case would incorrectly highlight the
      // other author's lines as well.
      const reverted = revertPatchWithDiagnostics(rightContent, file.patch);
      const left = this.content.put(reverted.content, leftTarget);
      const right = this.content.put(rightContent, rightTarget);
      const unresolved = reverted.unmatchedBlocks
        ? ` · ${reverted.unmatchedBlocks} overwritten or moved change${reverted.unmatchedBlocks === 1 ? '' : 's'}`
        : '';
      const title = `${file.path} (author changes${unresolved})`;
      await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
      return;
    }
    const revision = source === 'commit' ? file.commitHash ?? snapshot.activeCommit : undefined;
    // The tree is calculated with Git's three-dot comparison. Use that same
    // merge base for the editor's left pane; reading the latest base-branch
    // tip can show unrelated changes made after the branches diverged.
    const leftRef = revision
      ? `${revision}^`
      : await repository.comparisonBase(snapshot.repository.baseBranch);
    const rightRef = revision ?? 'HEAD';
    const left = this.content.put(await this.contentForRef(repository, leftRef, leftPath), leftTarget);
    const right = revision
      ? this.content.put(await this.contentForRef(repository, rightRef, file.path), rightTarget)
      : await this.currentFileOrEmpty(rightTarget);
    const title = revision
      ? `${file.path} (${revision.slice(0, 8)})`
      : `${file.path} (${snapshot.repository.baseBranch}…working tree)`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: true });
  }

  async exportDiffs(
    snapshot: DiffSnapshot,
    requestedFiles: Array<{ path: string; source: ChangedFile['source'] }>,
  ): Promise<void> {
    const requested = new Set(requestedFiles.map((file) => `${file.source}\u0000${file.path}`));
    const files = snapshot.files.filter((file) => requested.has(`${file.source}\u0000${file.path}`));
    if (!files.length) {
      void vscode.window.showInformationMessage('No filtered diff files are available to export.');
      return;
    }
    const selected = await vscode.window.showOpenDialog({
      title: `Export ${files.length} filtered diff file${files.length === 1 ? '' : 's'}`,
      openLabel: 'Export Here',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    const destination = selected?.[0];
    if (!destination) return;

    const exports = files.flatMap((file) => {
      const relativePath = diffExportRelativePath(file.path);
      if (!relativePath) return [];
      const parts = relativePath.split('/');
      return [{ file, relativePath, target: vscode.Uri.joinPath(destination, ...parts) }];
    });
    if (!exports.length) throw new Error('No safe repository-relative paths were found.');

    let existingCount = 0;
    for (const item of exports) {
      try {
        await vscode.workspace.fs.stat(item.target);
        existingCount += 1;
      } catch {
        // A missing target is expected for a new export.
      }
    }
    if (existingCount) {
      const choice = await vscode.window.showWarningMessage(
        `${existingCount} exported diff file${existingCount === 1 ? '' : 's'} already exist in the selected directory.`,
        { modal: true, detail: 'Only matching .diff files will be overwritten; other files are left unchanged.' },
        'Overwrite',
      );
      if (choice !== 'Overwrite') return;
    }

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Exporting ${exports.length} filtered diffs`,
      cancellable: false,
    }, async (progress) => {
      const increment = 100 / exports.length;
      for (const item of exports) {
        const parts = item.relativePath.split('/');
        const parent = parts.length > 1 ? vscode.Uri.joinPath(destination, ...parts.slice(0, -1)) : destination;
        await vscode.workspace.fs.createDirectory(parent);
        await vscode.workspace.fs.writeFile(item.target, Buffer.from(diffExportContent(item.file.patch), 'utf8'));
        progress.report({ increment, message: item.file.path });
      }
    });

    const action = await vscode.window.showInformationMessage(
      `Exported ${exports.length} filtered diff file${exports.length === 1 ? '' : 's'} with the repository directory structure.`,
      'Reveal Folder',
    );
    if (action === 'Reveal Folder') await vscode.commands.executeCommand('revealFileInOS', destination);
  }

  async openPath(repositoryPath: string | undefined, path: string, line?: number): Promise<void> {
    const target = this.safeTarget(repositoryPath, path);
    if (!target) {
      void vscode.window.showWarningMessage('Branch Diff Explorer refused to open a reviewer path outside the repository.');
      return;
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    const editor = await vscode.window.showTextDocument(document, { preview: true });
    if (line && line > 0) {
      const position = new vscode.Position(Math.min(line - 1, Math.max(0, document.lineCount - 1)), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }
  }

  async copyPath(repositoryPath: string | undefined, path: string, kind: 'absolute' | 'relative' | 'name' | 'uri'): Promise<void> {
    const target = this.safeTarget(repositoryPath, path);
    if (!target || !repositoryPath) return;
    const value = kind === 'absolute'
      ? target
      : kind === 'name'
        ? basename(target)
        : kind === 'uri'
          ? vscode.Uri.file(target).toString()
          : relative(repositoryPath, target).replaceAll('\\', '/');
    await vscode.env.clipboard.writeText(value);
    void vscode.window.setStatusBarMessage(`Branch Diff Explorer: copied ${kind} path`, 1800);
  }

  async revealPath(repositoryPath: string | undefined, path: string): Promise<void> {
    const target = this.safeTarget(repositoryPath, path);
    if (!target) return;
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target));
  }

  async revealInExplorer(repositoryPath: string | undefined, path: string): Promise<void> {
    const target = this.safeTarget(repositoryPath, path);
    if (!target) return;
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target));
  }

  async findInFolder(repositoryPath: string | undefined, path: string): Promise<void> {
    const target = this.safeTarget(repositoryPath, path);
    if (!target || !repositoryPath) return;
    const relativePath = relative(repositoryPath, target).replaceAll('\\', '/');
    await vscode.commands.executeCommand('workbench.action.findInFiles', { filesToInclude: `${relativePath}/**` });
  }

  async toggleFavorite(snapshot: DiffSnapshot, path: string): Promise<void> {
    await this.toggleStringState(snapshot, 'favorites', path);
  }

  async toggleReviewed(snapshot: DiffSnapshot, path: string): Promise<void> {
    await this.toggleStringState(snapshot, 'reviewed', path);
  }

  async triage(snapshot: DiffSnapshot, findingId: string, decision: 'agreed' | 'skipped'): Promise<void> {
    const key = `${this.stateKey(snapshot)}:triage`;
    const current = this.context.workspaceState.get<Record<string, 'agreed' | 'skipped'>>(key, {});
    const next = { ...current, [findingId]: current[findingId] === decision ? undefined : decision };
    if (!next[findingId]) delete next[findingId];
    await this.context.workspaceState.update(key, next);
  }

  async showMcpSetup(): Promise<void> {
    const selection = await vscode.window.showQuickPick([
      {
        label: '$(copy) Copy Codex MCP configuration',
        description: 'TOML for ~/.codex/config.toml or a project .codex/config.toml',
        action: 'codex',
      },
      {
        label: '$(copy) Copy Claude Code MCP configuration',
        description: 'JSON entry for the project .mcp.json file',
        action: 'claude',
      },
      {
        label: '$(beaker) Test local MCP server',
        description: 'Start the bundled server and verify that it can read saved sessions',
        action: 'test',
      },
    ], { title: 'Branch Diff Explorer MCP', placeHolder: 'Choose an MCP setup action' });
    if (selection?.action === 'codex') await this.copyCodexMcpConfig();
    if (selection?.action === 'claude') await this.copyClaudeMcpConfig();
    if (selection?.action === 'test') await this.testMcp();
  }

  async copyCodexMcpConfig(): Promise<void> {
    if (!await this.ensureMcpAvailable()) return;
    await this.syncMcpState(this.sessions());
    const config = [
      '[mcp_servers.branch_diff_explorer]',
      `command = ${tomlString(this.mcpNodeCommand())}`,
      `args = [${tomlString(this.mcpRuntimeUri.fsPath)}, "--state", ${tomlString(this.mcpStateUri.fsPath)}]`,
      'startup_timeout_sec = 20',
      'tool_timeout_sec = 120',
    ].join('\n');
    await vscode.env.clipboard.writeText(config);
    void vscode.window.showInformationMessage('Copied Codex MCP configuration. Add it to ~/.codex/config.toml or this project’s .codex/config.toml, then restart the Codex client.');
  }

  async copyClaudeMcpConfig(): Promise<void> {
    if (!await this.ensureMcpAvailable()) return;
    await this.syncMcpState(this.sessions());
    const config = JSON.stringify({
      mcpServers: {
        'branch-diff-explorer': {
          command: this.mcpNodeCommand(),
          args: [this.mcpRuntimeUri.fsPath, '--state', this.mcpStateUri.fsPath],
        },
      },
    }, null, 2);
    await vscode.env.clipboard.writeText(config);
    void vscode.window.showInformationMessage('Copied Claude Code MCP configuration. Merge it into this project’s .mcp.json, then reconnect the client.');
  }

  async testMcp(): Promise<void> {
    if (!await this.ensureMcpAvailable()) return;
    try {
      await this.syncMcpState(this.sessions());
      const { stdout } = await execFileAsync(
        this.mcpNodeCommand(),
        [this.mcpRuntimeUri.fsPath, '--state', this.mcpStateUri.fsPath, '--self-test'],
        { encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      );
      const response = JSON.parse(stdout);
      const sessions = Array.isArray(response.sessions) ? response.sessions : [];
      const count = sessions.filter((session: { repositoryPath?: unknown }) => typeof session?.repositoryPath === 'string').length;
      if (!count) throw new Error('The server returned no saved sessions.');
      void vscode.window.showInformationMessage(`Branch Diff Explorer MCP is ready · ${count} session${count === 1 ? '' : 's'} available.`);
    } catch (error) {
      const message = `MCP self-test failed: ${errorMessage(error)}`;
      const action = await vscode.window.showErrorMessage(`Branch Diff Explorer: ${message}`, 'Open Settings');
      if (action === 'Open Settings') await this.openSettings();
    }
  }

  async openSettings(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'branchDiffExplorer');
  }

  async showError(message: string): Promise<void> {
    const action = await vscode.window.showErrorMessage(`Branch Diff Explorer: ${message}`, 'Open Settings');
    if (action === 'Open Settings') await this.openSettings();
  }

  private async contentForRef(repository: GitRepository, ref: string, path: string): Promise<string> {
    try {
      return await repository.contentAt(ref, path);
    } catch {
      // New/deleted files have no content on one side of a diff.
      return '';
    }
  }

  private async currentFileOrEmpty(target: vscode.Uri): Promise<vscode.Uri> {
    try {
      await vscode.workspace.fs.stat(target);
      return target;
    } catch {
      // Deleted files need an empty right side instead of their HEAD contents.
      return this.content.put('', target);
    }
  }

  private async currentContentOrEmpty(target: vscode.Uri): Promise<string> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
    } catch {
      return '';
    }
  }

  private async forwardNavigation(
    command: string,
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Definition | undefined> {
    const target = this.content.target(document.uri);
    if (!target) return undefined;
    try {
      return await vscode.commands.executeCommand<vscode.Definition>(command, target, position);
    } catch {
      // Historical or deleted paths may not exist in the active workspace.
      return undefined;
    }
  }

  private safeTarget(repositoryPath: string | undefined, path: string): string | undefined {
    if (!repositoryPath) return undefined;
    const target = resolve(repositoryPath, path);
    const targetRelative = relative(repositoryPath, target);
    return targetRelative === '..' || targetRelative.startsWith(`..${sep}`) || isAbsolute(targetRelative) ? undefined : target;
  }

  private stateKey(snapshot: DiffSnapshot): string {
    return `branchDiffExplorer.state:${snapshot.repository.path}:${snapshot.repository.branch}`;
  }

  private gitRunOptions(resource: vscode.Uri): GitRunOptions {
    const configuration = vscode.workspace.getConfiguration('branchDiffExplorer', resource);
    const configuredMegabytes = configuration.get<number>('gitMaxOutputBufferMB', 256);
    const configuredTimeout = configuration.get<number>('gitCommandTimeoutMs', 0);
    const maxMegabytes = clamp(configuredMegabytes, 16, 4096, 256);
    const timeout = clamp(configuredTimeout, 0, 600000, 0);
    return {
      maxBuffer: maxMegabytes * 1024 * 1024,
      timeout: timeout || undefined,
    };
  }

  private sessions(): ExplorerSession[] {
    const stored = this.context.workspaceState.get<unknown>(SESSIONS_STORAGE_KEY);
    if (!Array.isArray(stored)) return [{ id: 'default', name: 'Default', config: {} }];
    const valid = stored.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const raw = candidate as Partial<ExplorerSession>;
      return typeof raw.id === 'string' && typeof raw.name === 'string' && raw.config && typeof raw.config === 'object'
        ? [{ id: raw.id, name: raw.name, config: raw.config }]
        : [];
    });
    return valid.length ? valid : [{ id: 'default', name: 'Default', config: {} }];
  }

  private async saveSessions(sessions: ExplorerSession[]): Promise<void> {
    await this.context.workspaceState.update(SESSIONS_STORAGE_KEY, sessions);
    try {
      await this.syncMcpState(sessions);
      this.mcpInitializationError = undefined;
    } catch (error) {
      // Diff browsing must remain available even if Node or the bundled MCP
      // runtime cannot be prepared. MCP setup/self-test surfaces this error.
      this.mcpInitializationError = errorMessage(error);
    }
  }

  private async prepareMcpRuntime(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dirname(this.mcpStateUri.fsPath)));
    const bundled = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mcp-server.js');
    await vscode.workspace.fs.copy(bundled, this.mcpRuntimeUri, { overwrite: true });
  }

  private async syncMcpState(sessions: ExplorerSession[]): Promise<void> {
    await this.mcpReady;
    const fallbackRepository = sessions.some((session) => !session.config.repositoryPath)
      ? (await this.repositories())[0]?.path
      : undefined;
    const exportedSessions = sessions.map((session) => ({
      ...session,
      config: {
        ...session.config,
        repositoryPath: session.config.repositoryPath ?? fallbackRepository,
        authorIds: session.config.authorIds ? [...session.config.authorIds] : [],
        ui: session.config.ui ? { ...session.config.ui } : {},
      },
    }));
    const repositories: Record<string, McpRepositorySettings> = {};
    for (const repositoryPath of new Set(exportedSessions.map((session) => session.config.repositoryPath).filter((path): path is string => Boolean(path)))) {
      const configuration = vscode.workspace.getConfiguration('branchDiffExplorer', vscode.Uri.file(repositoryPath));
      repositories[repositoryPath] = {
        defaultBaseBranch: configuration.get<string>('defaultBaseBranch', ''),
        maxChangedLines: clamp(configuration.get<number>('maxChangedLines', 4000), 100, 20_000, 4_000),
        gitMaxOutputBufferMB: clamp(configuration.get<number>('gitMaxOutputBufferMB', 256), 16, 4_096, 256),
        gitCommandTimeoutMs: clamp(configuration.get<number>('gitCommandTimeoutMs', 0), 0, 600_000, 0),
      };
    }
    const state: McpState = {
      version: 1,
      updatedAt: new Date().toISOString(),
      activeSessionId: this.activeSessionId ?? exportedSessions[0]?.id,
      sessions: exportedSessions,
      repositories,
    };
    const parent = vscode.Uri.file(dirname(this.mcpStateUri.fsPath));
    await vscode.workspace.fs.createDirectory(parent);
    const temporary = vscode.Uri.joinPath(parent, `${MCP_STATE_FILE}.${process.pid}.${Date.now()}.tmp`);
    await vscode.workspace.fs.writeFile(temporary, Buffer.from(`${JSON.stringify(state, null, 2)}\n`, 'utf8'));
    await vscode.workspace.fs.rename(temporary, this.mcpStateUri, { overwrite: true });
  }

  private async ensureMcpAvailable(): Promise<boolean> {
    try {
      await this.mcpReady;
      return true;
    } catch (error) {
      const message = this.mcpInitializationError ?? errorMessage(error);
      void vscode.window.showErrorMessage(`Branch Diff Explorer: MCP runtime is unavailable: ${message}`);
      return false;
    }
  }

  private mcpNodeCommand(): string {
    return vscode.workspace.getConfiguration('branchDiffExplorer').get<string>('mcpNodeCommand', 'node').trim() || 'node';
  }

  private async toggleStringState(snapshot: DiffSnapshot, kind: 'favorites' | 'reviewed', value: string): Promise<void> {
    const key = `${this.stateKey(snapshot)}:${kind}`;
    const current = this.context.workspaceState.get<string[]>(key, []);
    const next = current.includes(value) ? current.filter((item) => item !== value) : [...current, value];
    await this.context.workspaceState.update(key, next);
  }

  private decorateFindings(snapshot: DiffSnapshot | undefined): void {
    if (!snapshot) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.scheme !== 'file') continue;
      const path = relative(snapshot.repository.path, editor.document.uri.fsPath).replaceAll('\\', '/');
      for (const severity of Object.keys(this.decorations) as FindingSeverity[]) {
        const ranges = snapshot.reviewer.findings
          .filter((finding) => finding.file === path && finding.severity === severity && finding.line)
          .map((finding) => {
            const line = Math.min(Math.max(0, finding.line! - 1), Math.max(0, editor.document.lineCount - 1));
            return { range: new vscode.Range(line, 0, line, 0), hoverMessage: `**${finding.severity}** — ${finding.title}${finding.message ? `\n\n${finding.message}` : ''}` };
          });
        editor.setDecorations(this.decorations[severity], ranges);
      }
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refreshAll(), 250);
  }

  private refreshAll(): void {
    this.sidebar.refresh();
    for (const client of this.clients) void client.refresh();
  }
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /maxBuffer|stdout maxBuffer/i.test(message)
    ? `${message} Increase “Git max output buffer (MB)” in Branch Diff Explorer settings, then refresh.`
    : message;
}

function clamp(value: number, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function tomlString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function activate(context: vscode.ExtensionContext): void {
  new ExplorerController(context);
}

export function deactivate(): void {}
