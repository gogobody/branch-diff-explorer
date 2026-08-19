/** Maps a repository-relative source path to its exported unified-diff path. */
export function diffExportRelativePath(path: string): string | undefined {
  const normalized = path.replaceAll('\\', '/');
  if (normalized.startsWith('/')) return undefined;
  const parts = normalized.split('/');
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..')) return undefined;
  return `${parts.join('/')}.diff`;
}

export function diffExportContent(patch: string): string {
  if (!patch) return '';
  return patch.endsWith('\n') ? patch : `${patch}\n`;
}
