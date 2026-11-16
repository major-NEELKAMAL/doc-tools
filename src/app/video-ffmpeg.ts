import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

/**
 * ffmpeg.wasm, loaded on first use. The single-threaded core needs no
 * cross-origin isolation headers; it is ~32 MB, so it comes from the CDN
 * (Workers static assets cap files at 25 MiB) and the browser caches it.
 */
const CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

export const VIDEO_ACCEPT = 'video/mp4,video/webm,video/quicktime,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv';

export function isVideo(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|mkv)$/i.test(file.name);
}

/** What `ffmpeg -i` reports about a file. */
export interface VideoInfo {
  duration: number;
  video: { codec: string; width: number; height: number; fps: number } | null;
  audio: { codec: string; rate: number; layout: string } | null;
}

export type Progress = (fraction: number) => void;

let loading: Promise<FFmpeg> | null = null;
let instance: FFmpeg | null = null;
/** ffmpeg runs one command at a time, so jobs queue up. */
let queue: Promise<unknown> = Promise.resolve();
let jobId = 0;

function ffmpeg(): Promise<FFmpeg> {
  loading ??= (async () => {
    const ff = new FFmpeg();
    await ff.load({
      // The package's own `new URL('./worker.js')` is not bundled by the Angular build; angular.json copies it here.
      classWorkerURL: new URL('/ffmpeg/worker.js', location.href).href,
      coreURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE_URL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    instance = ff;
    return ff;
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Stops whatever is running; the next job loads a fresh ffmpeg. */
export function cancelVideoJob(): void {
  instance?.terminate();
  instance = null;
  loading = null;
}

function job<T>(fn: (ff: FFmpeg) => Promise<T>): Promise<T> {
  const next = queue.then(async () => fn(await ffmpeg()));
  queue = next.catch(() => undefined);
  return next;
}

/** Mounts the files read-only (no copy into wasm memory) and cleans up afterwards. */
async function withInputs<T>(ff: FFmpeg, files: File[], fn: (paths: string[], dir: string) => Promise<T>): Promise<T> {
  const dir = `/job${++jobId}`;
  await ff.createDir(dir);
  const mounts: string[] = [];
  try {
    const paths: string[] = [];
    for (const [i, file] of files.entries()) {
      const mount = `${dir}/in${i}`;
      await ff.createDir(mount);
      await ff.mount(FFFSType.WORKERFS, { files: [file] }, mount);
      mounts.push(mount);
      paths.push(`${mount}/${file.name}`);
    }
    return await fn(paths, dir);
  } finally {
    for (const m of mounts) await ff.unmount(m).catch(() => undefined);
    for (const m of mounts) await ff.deleteDir(m).catch(() => undefined);
    const left = await ff.listDir(dir).catch(() => []);
    for (const n of left) if (!n.isDir) await ff.deleteFile(`${dir}/${n.name}`).catch(() => undefined);
    await ff.deleteDir(dir).catch(() => undefined);
  }
}

/** Runs ffmpeg, reporting progress against `total` seconds of output. Returns the log. */
async function run(ff: FFmpeg, args: string[], total = 0, onProgress?: Progress): Promise<{ code: number; log: string }> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => {
    lines.push(message);
    const t = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    if (t && total > 0) onProgress?.(Math.min(1, (+t[1] * 3600 + +t[2] * 60 + +t[3]) / total));
  };
  ff.on('log', onLog);
  try {
    const code = await ff.exec(['-hide_banner', ...args]);
    return { code, log: lines.join('\n') };
  } finally {
    ff.off('log', onLog);
  }
}

function parseInfo(log: string): VideoInfo {
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(log);
  const v = /Stream #0:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})/.exec(log);
  const fps = /, (\d+(?:\.\d+)?) fps/.exec(log);
  const a = /Stream #0:\d+.*?: Audio: (\w+).*?, (\d+) Hz, ([\w.()]+)/.exec(log);
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    video: v ? { codec: v[1], width: +v[2], height: +v[3], fps: fps ? +fps[1] : 30 } : null,
    audio: a ? { codec: a[1], rate: +a[2], layout: a[3] } : null,
  };
}

async function probe(ff: FFmpeg, path: string): Promise<VideoInfo> {
  return parseInfo((await run(ff, ['-i', path])).log); // exits non-zero: no output file
}

async function readOutput(ff: FFmpeg, path: string, type: string): Promise<Blob> {
  const data = (await ff.readFile(path)) as Uint8Array;
  await ff.deleteFile(path);
  return new Blob([data], { type });
}

function ext(file: File): string {
  return (/\.(\w+)$/.exec(file.name)?.[1] ?? 'mp4').toLowerCase();
}

function mime(extension: string): string {
  return { webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' }[extension] ?? 'video/mp4';
}

const H264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
const AAC = ['-c:a', 'aac', '-b:a', '128k'];

export interface TrimResult {
  blob: Blob;
  extension: string;
}

/**
 * Cuts [start, end) seconds out of the video. `exact` re-encodes so the cut
 * lands on the exact frame; otherwise the streams are copied (instant, but
 * the start snaps to the nearest keyframe before it).
 */
export function trimVideo(file: File, start: number, end: number, exact: boolean, onProgress?: Progress): Promise<TrimResult> {
  return job((ff) =>
    withInputs(ff, [file], async ([input], dir) => {
      const extension = exact ? 'mp4' : ext(file);
      const out = `${dir}/out.${extension}`;
      const codecs = exact ? [...H264, ...AAC, '-movflags', '+faststart'] : ['-c', 'copy', '-avoid_negative_ts', 'make_zero'];
      const { code } = await run(
        ff,
        ['-ss', String(start), '-i', input, '-t', String(end - start), '-map', '0:v?', '-map', '0:a?', ...codecs, out],
        end - start,
        onProgress,
      );
      if (code !== 0) throw new Error('ffmpeg exited with ' + code);
      return { blob: await readOutput(ff, out, mime(extension)), extension };
    }),
  );
}

/**
 * Joins the videos in order. When they all share codecs, size and audio
 * format the streams are copied (fast); otherwise everything is re-encoded
 * to H.264/AAC MP4 at the first video's size, letterboxing the others.
 */
export function mergeVideos(files: File[], onProgress?: Progress): Promise<TrimResult> {
  return job((ff) =>
    withInputs(ff, files, async (inputs, dir) => {
      const infos: VideoInfo[] = [];
      for (const p of inputs) infos.push(await probe(ff, p));
      if (infos.some((i) => !i.video)) throw new Error('A file has no video stream.');
      const total = infos.reduce((s, i) => s + i.duration, 0);

      const sig = (i: VideoInfo) =>
        [i.video!.codec, i.video!.width, i.video!.height, i.audio?.codec, i.audio?.rate, i.audio?.layout].join('|');
      const extensions = new Set(files.map(ext));
      if (new Set(infos.map(sig)).size === 1 && extensions.size === 1) {
        const extension = ext(files[0]);
        const list = `${dir}/list.txt`;
        await ff.writeFile(list, inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'));
        const out = `${dir}/out.${extension}`;
        const { code } = await run(ff, ['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out], total, onProgress);
        if (code === 0) return { blob: await readOutput(ff, out, mime(extension)), extension };
        await ff.deleteFile(out).catch(() => undefined); // fall back to re-encoding
      }

      const first = infos[0].video!;
      const w = first.width & ~1;
      const h = first.height & ~1;
      const fps = Math.min(60, Math.round(first.fps) || 30);
      const withAudio = infos.some((i) => i.audio);
      const args: string[] = [];
      inputs.forEach((p) => args.push('-i', p));
      // Videos without sound get a silent track so the concat filter lines up.
      const silent = new Map<number, number>();
      infos.forEach((info, i) => {
        if (withAudio && !info.audio) {
          silent.set(i, inputs.length + silent.size);
          args.push('-f', 'lavfi', '-t', String(info.duration || 1), '-i', 'anullsrc=r=44100:cl=stereo');
        }
      });
      const filters: string[] = [];
      let pads = '';
      infos.forEach((_, i) => {
        filters.push(
          `[${i}:v:0]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p[v${i}]`,
        );
        pads += `[v${i}]`;
        if (withAudio) {
          const src = silent.has(i) ? `${silent.get(i)}:a:0` : `${i}:a:0`;
          filters.push(`[${src}]aresample=44100,aformat=channel_layouts=stereo[a${i}]`);
          pads += `[a${i}]`;
        }
      });
      filters.push(`${pads}concat=n=${infos.length}:v=1:a=${withAudio ? 1 : 0}${withAudio ? '[v][a]' : '[v]'}`);
      const out = `${dir}/out.mp4`;
      const { code } = await run(
        ff,
        [
          ...args,
          '-filter_complex',
          filters.join(';'),
          '-map',
          '[v]',
          ...(withAudio ? ['-map', '[a]', ...AAC] : []),
          ...H264,
          '-movflags',
          '+faststart',
          out,
        ],
        total,
        onProgress,
      );
      if (code !== 0) throw new Error('ffmpeg exited with ' + code);
      return { blob: await readOutput(ff, out, 'video/mp4'), extension: 'mp4' };
    }),
  );
}

/** "90", "1:30", "01:01:30.5" → seconds; NaN when it does not parse. */
export function parseTime(text: string): number {
  const parts = text.trim().split(':');
  if (!text.trim() || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  return parts.reduce((s, p) => s * 60 + +p, 0);
}

/** Seconds → "m:ss.s" or "h:mm:ss.s". */
export function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}
