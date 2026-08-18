export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'unknown';
export type ChangeSource = 'committed' | 'staged' | 'unstaged' | 'author' | 'commit';

export interface ChangedLine {
  kind: 'addition' | 'deletion';
  line: number;
  text: string;
}

export interface ChangedFile {
  path: string;
  previousPath?: string;
  status: ChangeStatus;
  source: ChangeSource;
  /** All Git states represented by this path when changes are combined. */
  sources?: ChangeSource[];
  /** Commit used for an author or single-commit side-by-side diff. */
  commitHash?: string;
  additions: number;
  deletions: number;
  lines: ChangedLine[];
  patch: string;
}

export interface CommitRecord {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  subject: string;
  date: string;
}

export interface CommitAuthor {
  id: string;
  name: string;
  email: string;
  commitCount: number;
}

export interface RepositoryInfo {
  path: string;
  name: string;
  branch: string;
  branches: string[];
  baseBranch: string;
}

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'nit';

export interface ReviewerFinding {
  id: string;
  file: string;
  line?: number;
  severity: FindingSeverity;
  source?: string;
  title: string;
  message?: string;
}

export interface ReviewerAbsence {
  id: string;
  file?: string;
  line?: number;
  severity: FindingSeverity;
  kind?: string;
  subject: string;
  ask?: string;
}

export interface ReviewerBriefing {
  intent?: string;
  summary: string[];
  reviewOrder: Array<{ path: string; reason?: string }>;
  skipList: string[];
}

export interface ReviewerData {
  findings: ReviewerFinding[];
  absences: ReviewerAbsence[];
  briefing?: ReviewerBriefing;
  warning?: string;
}

export interface DiffSnapshot {
  repository: RepositoryInfo;
  files: ChangedFile[];
  totals: {
    files: number;
    additions: number;
    deletions: number;
  };
  commits: CommitRecord[];
  authors: CommitAuthor[];
  activeAuthorIds: string[];
  activeAuthorKeyword: string;
  activeCommit?: string;
  truncated: boolean;
  behindBase: number;
  reviewer: ReviewerData;
  favorites: string[];
  reviewedFiles: string[];
  triage: Record<string, 'agreed' | 'skipped'>;
  notice?: string;
}

export interface SnapshotRequest {
  baseBranch?: string;
  authorIds?: string[];
  authorKeyword?: string;
  commitHash?: string;
}
