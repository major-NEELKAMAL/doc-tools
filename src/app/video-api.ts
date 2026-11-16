/**
 * Video crop / merge run on the server (risegap-api VideoJobService): the
 * video is uploaded in 10 MB chunks (each request under the API's 15 MB
 * limit), a job cuts or joins it with native ffmpeg, the page polls the job
 * and then plays the result straight from the server — the player fetches
 * byte ranges as it plays, so the whole video is never held in the browser.
 */

/** ng serve on :4200 talks to the test API (it allows that origin); the site to prod. */
const API =
  location.hostname === 'localhost' || location.hostname === '127.0.0.1'
    ? 'https://api-test.risegap.com/api/v1/public/doc-tools'
    : 'https://api.risegap.com/api/v1/public/doc-tools';

export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
/** The merge inputs together (and so the merged video) — the server's cap. */
export const MAX_MERGE_BYTES = 2 * 1024 * 1024 * 1024;
const CHUNK_BYTES = 10 * 1024 * 1024;

export const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv';

export function isVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
}

export type Progress = (fraction: number) => void;

/** A crop / merge input: a finished upload, or an earlier job's result. */
export type VideoSource = { upload: string } | { job: string };

export interface JobStatus {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
  progress: number;
  error: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

/** A finished job, ready to play and download. */
export interface VideoResult {
  jobId: string;
  name: string;
  size: number;
  url: string;
  downloadUrl: string;
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(API + path, {
    method,
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.message || `The server answered ${res.status}. Please try again.`);
  return json?.data as T;
}

/** Uploads [file] in chunks; resolves to its upload id. */
export async function uploadVideo(file: File, onProgress?: Progress, signal?: AbortSignal): Promise<string> {
  const uploadId = crypto.randomUUID();
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  for (let i = 0; i < chunks; i++) {
    const body = new FormData();
    body.append('tool', 'video');
    body.append('uploadId', uploadId);
    body.append('chunk', String(i));
    body.append('last', String(i === chunks - 1));
    body.append('file', file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES), file.name);
    let res: Response | undefined;
    // A dropped connection on a phone shouldn't lose the whole upload: retry the chunk.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(API + '/files', { method: 'POST', body, signal });
        break;
      } catch (e) {
        if (signal?.aborted || attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    if (!res!.ok) {
      const json = await res!.json().catch(() => null);
      throw new Error(json?.message || 'The upload was refused. Please try again.');
    }
    onProgress?.((i + 1) / chunks);
  }
  return uploadId;
}

export function startTrim(source: VideoSource, name: string, start: number, end: number, exact: boolean): Promise<string> {
  return call<{ jobId: string }>('POST', '/video/trim', { source, name, start, end, exact }).then((d) => d.jobId);
}

export function startMerge(sources: VideoSource[], name: string): Promise<string> {
  return call<{ jobId: string }>('POST', '/video/merge', { sources, name }).then((d) => d.jobId);
}

export function cancelJob(jobId: string): void {
  call('DELETE', '/video/jobs/' + jobId).catch(() => undefined);
}

/** Polls the job until it ends; resolves with the result, rejects with the server's error. */
export async function waitForJob(jobId: string, onProgress?: Progress, signal?: AbortSignal): Promise<VideoResult> {
  for (;;) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const s = await call<JobStatus>('GET', '/video/jobs/' + jobId, undefined, signal);
    if (s.status === 'DONE') {
      onProgress?.(1);
      const url = `${API}/video/jobs/${jobId}/file`;
      return { jobId, name: s.fileName ?? 'video.mp4', size: s.sizeBytes ?? 0, url, downloadUrl: url + '?download=true' };
    }
    if (s.status === 'FAILED' || s.status === 'CANCELLED') throw new Error(s.error || 'The video job stopped.');
    onProgress?.(s.progress);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Seconds → "m:ss.s" or "h:mm:ss.s". */
export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

export function formatSize(n: number): string {
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
