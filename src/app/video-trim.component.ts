import { Component, OnDestroy, computed, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VideoPlayerComponent } from './video-player.component';
import {
  MAX_VIDEO_BYTES,
  VIDEO_ACCEPT,
  VideoResult,
  cancelJob,
  formatSize,
  formatTime,
  isVideo,
  startCut,
  uploadVideo,
  waitForJob,
} from './video-api';

interface Source {
  file: File;
  /** Local object URL: the browser reads the file from disk as it plays. */
  url: string;
  /** Resolves to the upload id once every chunk is on the server. */
  upload: Promise<string>;
  abort: AbortController;
}

/**
 * Cuts a part out of a video: what lies between "Cut from" and "Cut to" is
 * removed and the rest is joined.
 * The video uploads as soon as it is picked; the cut runs on the server and
 * the result plays (streamed in ranges) from there.
 */
@Component({
  selector: 'app-video-trim',
  standalone: true,
  imports: [FormsModule, VideoPlayerComponent],
  template: `
    <section class="panel controls">
      @if (!source()) {
        <label
          class="drop"
          [class.over]="dragging()"
          (dragover)="$event.preventDefault(); dragging.set(true)"
          (dragleave)="dragging.set(false)"
          (drop)="onDrop($event)"
        >
          <input type="file" [accept]="accept" (change)="onFileInput($event)" hidden />
          <strong>Click to choose a video</strong>
          <span>or drag &amp; drop here</span>
          <small>MP4, WEBM, MOV or MKV — up to 1 GB</small>
        </label>
      } @else {
        <div class="file">
          <span class="name" [title]="source()!.file.name">{{ source()!.file.name }}</span>
          <button type="button" class="link" (click)="clear()">Change</button>
        </div>
        @if (uploadState() !== 'done') {
          <div class="upload-state">
            @if (uploadState() === 'failed') {
              <span class="error">Upload failed — it will retry when you cut.</span>
            } @else {
              <span>Uploading {{ (uploadProgress() * 100).toFixed(0) }}% of {{ fsize(source()!.file.size) }}</span>
              <progress [value]="uploadProgress()" max="1"></progress>
            }
          </div>
        }
        <p class="step">
          Choose the part to remove — it is cut out and the rest is joined. Leave "Cut to" empty to remove
          everything from "Cut from" to the end.
          @if (duration()) {
            The video is {{ fmt(duration()) }} long.
          }
        </p>
        @for (t of times; track t.key) {
          <fieldset class="time">
            <legend>{{ t.label }}</legend>
            <div class="hms">
              @for (u of units; track u.key) {
                <label>
                  <input
                    type="number"
                    min="0"
                    [max]="u.key === 'h' ? null : 59"
                    [step]="u.key === 's' ? 0.1 : 1"
                    [attr.inputmode]="u.key === 's' ? 'decimal' : 'numeric'"
                    [placeholder]="t.key === 'to' && duration() ? endParts()[u.key] : '0'"
                    [(ngModel)]="t.value[u.key]"
                    [attr.aria-label]="t.label + ' ' + u.label"
                  />
                  <small>{{ u.label }}</small>
                </label>
              }
              <button type="button" class="secondary" (click)="useCurrent(t.key)">Use player time</button>
            </div>
            @if (t.key === 'to') {
              <small class="hint-left">Empty = remove to the end of the video</small>
            }
          </fieldset>
        }
        <label class="check">
          <input type="checkbox" [(ngModel)]="exact" />
          Exact cut (slower — re-encodes to MP4)
        </label>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        @if (phase() !== 'idle') {
          <p class="step">{{ phase() === 'uploading' ? 'Waiting for the upload to finish…' : 'Cutting on the server…' }}</p>
          <progress [value]="phase() === 'uploading' ? uploadProgress() : progress()" max="1"></progress>
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
        } @else {
          <button type="button" class="primary" (click)="crop()">Cut out this part</button>
        }

        @if (result(); as r) {
          <a class="download" [attr.href]="r.downloadUrl">Download edited video</a>
          <small class="hint">{{ r.name }} · {{ fsize(r.size) }}</small>
          <small class="note">Every cut starts from the original video — change the times and cut again anytime.</small>
          <div class="forward">
            <span>Use this result in</span>
            <div class="chips">
              <button type="button" class="secondary" (click)="merge.emit()">Video merge →</button>
            </div>
          </div>
        }
      }
      @if (!source() && error()) {
        <p class="error">{{ error() }}</p>
      }
    </section>

    <section class="panel preview video-preview">
      @if (playingUrl(); as url) {
        @if (result()) {
          <div class="tabs">
            <button type="button" [class.active]="view() === 'result'" (click)="view.set('result')">Edited</button>
            <button type="button" [class.active]="view() === 'original'" (click)="view.set('original')">Original</button>
          </div>
        }
        <app-video-player [src]="url" (durationChange)="onMeta($event)" />
      } @else {
        <p class="empty">The video plays here</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: contents;
    }
    progress {
      width: 100%;
    }
    .note {
      color: #6b7280;
      text-align: center;
    }
    .time {
      display: grid;
      gap: 6px;
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .time legend {
      padding: 0;
      margin-bottom: 6px;
      font-size: 0.9rem;
      color: #374151;
    }
    .hms {
      display: flex;
      gap: 8px;
      align-items: flex-start;
    }
    .hms label {
      flex: 1 1 0;
      min-width: 0;
      display: grid;
      gap: 2px;
      text-align: center;
    }
    .hms input {
      width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 9px 6px;
      border: 1px solid #cfd5dc;
      border-radius: 8px;
      font: inherit;
      text-align: center;
    }
    .hms small,
    .hint-left {
      color: #6b7280;
      font-size: 0.75rem;
    }
    .hms button {
      flex: 1.4 1 0;
      min-width: 0;
      padding: 9px 6px;
      font-size: 0.8rem;
      white-space: normal;
      line-height: 1.15;
    }
    .upload-state {
      display: grid;
      gap: 6px;
      font-size: 0.85rem;
      color: #4b5563;
    }
  `,
})
export class VideoTrimComponent implements OnDestroy {
  readonly accept = VIDEO_ACCEPT;
  /** "Video merge →" clicked. */
  readonly merge = output<void>();
  /** The edited video on the server, or null when there is none. */
  readonly cropped = output<VideoResult | null>();
  readonly player = viewChild(VideoPlayerComponent);

  /** Cut from / Cut to as hours, minutes, seconds (no colon to type on a phone keypad). */
  readonly times: { key: 'from' | 'to'; label: string; value: Hms }[] = [
    { key: 'from', label: 'Cut from', value: emptyHms() },
    { key: 'to', label: 'Cut to', value: emptyHms() },
  ];
  readonly units: { key: keyof Hms; label: string }[] = [
    { key: 'h', label: 'hr' },
    { key: 'm', label: 'min' },
    { key: 's', label: 'sec' },
  ];
  /** The video's length split up, shown as the "Cut to" placeholders. */
  readonly endParts = computed(() => toHms(this.duration()));
  exact = false;

  readonly source = signal<Source | null>(null);
  readonly uploadState = signal<'uploading' | 'done' | 'failed'>('uploading');
  readonly uploadProgress = signal(0);
  readonly result = signal<VideoResult | null>(null);
  readonly view = signal<'original' | 'result'>('original');
  readonly playingUrl = computed(() =>
    this.view() === 'result' && this.result() ? this.result()!.url : (this.source()?.url ?? null),
  );
  readonly duration = signal(0);
  /** idle, waiting for the upload, or the server job running. */
  readonly phase = signal<'idle' | 'uploading' | 'processing'>('idle');
  readonly progress = signal(0);
  readonly error = signal('');
  readonly dragging = signal(false);

  readonly fmt = formatTime;
  readonly fsize = formatSize;

  private job: { id: string | null; abort: AbortController } | null = null;

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.setFile(input.files?.[0]);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.setFile(event.dataTransfer?.files?.[0]);
  }

  onMeta(duration: number): void {
    if (this.view() === 'original') this.duration.set(duration);
  }

  useCurrent(which: 'from' | 'to'): void {
    const v = this.player();
    if (!v || this.view() !== 'original') {
      this.error.set('Switch the player to the original video first.');
      return;
    }
    Object.assign(this.times.find((t) => t.key === which)!.value, toHms(v.currentTime));
    this.error.set('');
  }

  async crop(): Promise<void> {
    const src = this.source();
    if (!src || this.phase() !== 'idle') return;
    const from = fromHms(this.times[0].value);
    const to = fromHms(this.times[1].value);
    if (Number.isNaN(from) || Number.isNaN(to)) {
      this.error.set('Minutes and seconds go from 0 to 59.');
      return;
    }
    const start = from ?? 0;
    // Empty "Cut to" = the end of the video. If the browser couldn't read the length (some .mkv files),
    // ask for a day's worth: the server stops at the video's real end.
    const end = to ?? (this.duration() || 24 * 3600);
    if (!(end > start)) {
      this.error.set('"Cut to" must be after "Cut from".');
      return;
    }
    if (this.duration() && start >= this.duration()) {
      this.error.set('"Cut from" is past the end of the video (' + formatTime(this.duration()) + ').');
      return;
    }
    if (start <= 0.05 && this.duration() && end >= this.duration() - 0.05) {
      this.error.set('That would remove the whole video.');
      return;
    }
    this.error.set('');
    const job = { id: null as string | null, abort: new AbortController() };
    this.job = job;
    try {
      if (this.uploadState() === 'failed') this.startUpload(src);
      this.phase.set('uploading');
      const uploadId = await this.source()!.upload;
      if (job.abort.signal.aborted) return;
      this.phase.set('processing');
      this.progress.set(0);
      job.id = await startCut({ upload: uploadId }, src.file.name, start, end, this.exact);
      if (job.abort.signal.aborted) {
        cancelJob(job.id);
        return;
      }
      const result = await waitForJob(job.id, (p) => this.progress.set(p), job.abort.signal);
      if (this.source() !== src) return;
      this.result.set(result);
      this.cropped.emit(result);
      this.view.set('result');
    } catch (e) {
      if (!job.abort.signal.aborted) this.error.set(e instanceof Error ? e.message : 'Could not cut this video.');
    } finally {
      if (this.job === job) {
        this.job = null;
        this.phase.set('idle');
      }
    }
  }

  cancel(): void {
    const job = this.job;
    if (!job) return;
    job.abort.abort();
    if (job.id) cancelJob(job.id);
    this.job = null;
    this.phase.set('idle');
    this.error.set('Cancelled.');
  }

  clear(): void {
    this.setSource(null);
    this.error.set('');
  }

  ngOnDestroy(): void {
    this.setSource(null);
  }

  private setFile(file: File | undefined): void {
    if (!file) return;
    if (!isVideo(file)) {
      this.error.set('Please choose a video file (MP4, WEBM, MOV or MKV).');
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      this.error.set(`This video is ${formatSize(file.size)} — videos up to 1 GB are supported.`);
      return;
    }
    this.error.set('');
    this.times.forEach((t) => (t.value = emptyHms()));
    const src: Source = { file, url: URL.createObjectURL(file), upload: Promise.resolve(''), abort: new AbortController() };
    this.setSource(src);
    this.startUpload(src);
  }

  /** (Re)starts uploading [src]; the crop waits on src.upload. */
  private startUpload(src: Source): void {
    src.abort.abort();
    src.abort = new AbortController();
    this.uploadState.set('uploading');
    this.uploadProgress.set(0);
    src.upload = uploadVideo(
      src.file,
      (p) => this.source() === src && this.uploadProgress.set(p),
      src.abort.signal,
    );
    src.upload.then(
      () => this.source() === src && this.uploadState.set('done'),
      () => this.source() === src && this.uploadState.set('failed'),
    );
  }

  private setSource(src: Source | null): void {
    this.cancel();
    const old = this.source();
    if (old) {
      old.abort.abort();
      URL.revokeObjectURL(old.url);
    }
    this.source.set(src);
    this.duration.set(0);
    this.view.set('original');
    this.result.set(null);
    this.cropped.emit(null);
  }
}

interface Hms {
  h: number | null;
  m: number | null;
  s: number | null;
}

function emptyHms(): Hms {
  return { h: null, m: null, s: null };
}

/** Seconds → whole hours and minutes, seconds to a tenth. */
function toHms(sec: number): Hms {
  const t = Math.max(0, Math.round(sec * 10) / 10);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return { h, m, s: Math.round((t - h * 3600 - m * 60) * 10) / 10 };
}

/** null when all three are empty, NaN when minutes or seconds are out of range. */
function fromHms(v: Hms): number | null {
  const empty = (x: number | null) => x === null || (x as unknown) === '';
  if (empty(v.h) && empty(v.m) && empty(v.s)) return null;
  const h = Number(v.h ?? 0);
  const m = Number(v.m ?? 0);
  const s = Number(v.s ?? 0);
  if ([h, m, s].some((x) => !Number.isFinite(x) || x < 0) || m >= 60 || s >= 60) return NaN;
  return h * 3600 + m * 60 + s;
}
