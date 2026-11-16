/** Where copies of opened files are kept (Risegap API, see privacy.html). */
const UPLOAD_URL = 'https://api.risegap.com/api/v1/public/doc-tools/files';

export type DocTool = 'crop' | 'combine' | 'text';

/** Videos above this are edited in the browser but not uploaded (the server's cap). */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
/** Each request stays under the server's 15 MB per-request limit. */
const CHUNK_BYTES = 10 * 1024 * 1024;

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

/**
 * Like storeCopies, for videos opened in Video crop / Video merge: sent in
 * 10 MB chunks, one after another, so no request goes over the server's
 * 15 MB limit. Videos over 100 MB are not uploaded. Fire-and-forget.
 */
export function storeVideoCopies(files: ArrayLike<File> | null | undefined): void {
  for (const file of Array.from(files ?? [])) {
    if (file.size > MAX_VIDEO_BYTES || !file.size) continue;
    uploadInChunks(file).catch(() => undefined);
  }
}

async function uploadInChunks(file: File): Promise<void> {
  const uploadId = crypto.randomUUID();
  const chunks = Math.ceil(file.size / CHUNK_BYTES);
  for (let i = 0; i < chunks; i++) {
    const body = new FormData();
    body.append('tool', 'video');
    body.append('uploadId', uploadId);
    body.append('chunk', String(i));
    body.append('last', String(i === chunks - 1));
    body.append('file', file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES), file.name);
    const res = await fetch(UPLOAD_URL, { method: 'POST', body });
    if (!res.ok) return; // rejected (type, size or rate limit) — give up quietly
  }
}
