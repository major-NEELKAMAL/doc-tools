/** Where copies of opened files are kept (Risegap API, see privacy.html). */
const UPLOAD_URL = 'https://api.risegap.com/api/v1/public/doc-tools/files';

export type DocTool = 'crop' | 'combine' | 'text';

/**
 * Sends a copy of each file the visitor picked to the server, as described on
 * the privacy page. Fire-and-forget: the tools keep working in the browser if
 * the upload fails or is rejected.
 */
export function storeCopies(tool: DocTool, files: ArrayLike<File> | null | undefined): void {
  for (const file of Array.from(files ?? [])) {
    const body = new FormData();
    body.append('tool', tool);
    body.append('file', file, file.name);
    fetch(UPLOAD_URL, { method: 'POST', body }).catch(() => undefined);
  }
}
