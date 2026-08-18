import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadReviewerData } from '../src/reviewer';

describe('loadReviewerData', () => {
  it('reads the public findings convention and ignores malformed records', async () => {
    const root = await mkdtemp(join(tmpdir(), 'branch-diff-reviewer-'));
    await mkdir(join(root, '.diffly'));
    await writeFile(join(root, '.diffly', 'findings.json'), JSON.stringify({
      briefing: { intent: 'Review auth', summary: ['Adds rate limiting'], reviewOrder: [{ path: 'src/auth.ts', reason: 'main path' }] },
      findings: [
        { id: 'security-1', file: 'src/auth.ts', line: 12, severity: 'critical', source: 'security', title: 'Missing bound' },
        { id: 'invalid-no-file', title: 'Ignored' },
      ],
      absences: [{ id: 'test-1', severity: 'high', subject: 'Tests', ask: 'Add coverage' }],
    }));

    const reviewer = await loadReviewerData(root);

    expect(reviewer.briefing?.intent).toBe('Review auth');
    expect(reviewer.findings).toEqual([expect.objectContaining({ id: 'security-1', line: 12, severity: 'critical' })]);
    expect(reviewer.absences).toEqual([expect.objectContaining({ id: 'test-1', severity: 'high' })]);
  });
});
