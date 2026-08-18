import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  FindingSeverity,
  ReviewerAbsence,
  ReviewerBriefing,
  ReviewerData,
  ReviewerFinding,
} from './types';

const severities = new Set<FindingSeverity>(['critical', 'high', 'medium', 'low', 'nit']);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function severity(value: unknown): FindingSeverity {
  return typeof value === 'string' && severities.has(value as FindingSeverity) ? value as FindingSeverity : 'medium';
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(asString).filter((item): item is string => Boolean(item))
    : [];
}

function parseFindings(value: unknown): ReviewerFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const file = asString(raw.file);
    const title = asString(raw.title);
    if (!file || !title) return [];
    return [{
      id: asString(raw.id) ?? `finding-${index + 1}`,
      file,
      line: typeof raw.line === 'number' && raw.line > 0 ? Math.floor(raw.line) : undefined,
      severity: severity(raw.severity),
      source: asString(raw.source),
      title,
      message: asString(raw.message),
    }];
  });
}

function parseAbsences(value: unknown): ReviewerAbsence[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as Record<string, unknown>;
    const subject = asString(raw.subject);
    if (!subject) return [];
    return [{
      id: asString(raw.id) ?? `absence-${index + 1}`,
      file: asString(raw.file),
      line: typeof raw.line === 'number' && raw.line > 0 ? Math.floor(raw.line) : undefined,
      severity: severity(raw.severity),
      kind: asString(raw.kind),
      subject,
      ask: asString(raw.ask),
    }];
  });
}

function parseBriefing(value: unknown): ReviewerBriefing | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const summary = strings(raw.summary);
  const reviewOrder = Array.isArray(raw.reviewOrder) ? raw.reviewOrder.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const path = asString(item.path);
    return path ? [{ path, reason: asString(item.reason) }] : [];
  }) : [];
  const skipList = strings(raw.skipList);
  const intent = asString(raw.intent);
  return intent || summary.length || reviewOrder.length || skipList.length ? { intent, summary, reviewOrder, skipList } : undefined;
}

/** Reads the public Diffly reviewer-file convention without sending it anywhere. */
export async function loadReviewerData(repositoryRoot: string): Promise<ReviewerData> {
  try {
    const contents = await readFile(join(repositoryRoot, '.diffly', 'findings.json'), 'utf8');
    const data = JSON.parse(contents) as Record<string, unknown>;
    return {
      findings: parseFindings(data.findings),
      absences: parseAbsences(data.absences),
      briefing: parseBriefing(data.briefing),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { findings: [], absences: [] };
    return {
      findings: [],
      absences: [],
      warning: 'Could not read .diffly/findings.json. Check that it contains valid JSON.',
    };
  }
}
