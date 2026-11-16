import { Component, OnDestroy, computed, effect, input, signal, untracked } from '@angular/core';
import { VideoPlayerComponent } from './video-player.component';
import {
  MAX_MERGE_BYTES,
  MAX_VIDEO_BYTES,
  VIDEO_ACCEPT,
  VideoResult,
  VideoSource,
  cancelJob,
  formatSize,
  isVideo,
  startMerge,
  uploadVideo,
  waitForJob,
} from './video-api';

interface Item {
  id: number;
  name: string;
  size: number;
  /** What the player plays: a local file (read from disk as it plays) or the server result (streamed in ranges). */
  url: string;
  /** A picked file, uploaded in the background. */
  file?: File;
  upload?: Promise<string>;
  abort?: AbortController;
  /** The Video crop result, already on the server. */
  job?: string;
}

interface UploadState {
  state: 'uploading' | 'done' | 'failed';
  progress: number;
}

/**
 * Several videos in a user-chosen order, joined into one on the server. Picked
 * videos upload as soon as they are added; the cropped clip from Video crop is
 * already on the server and goes first.
 */
@Component({
  selector: 'app-video-merge',
  standalone: true,
  imports: [VideoPlayerComponent],
  template: `
    <section class="panel controls">
      <label
        class="drop"
        [class.small]="items().length"
        [class.over]="dragging()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragging.set(false)"
        (drop)="onDrop($event)"
      >
        <input type="file" [accept]="accept" multiple (change)="onFileInput($event)" hidden />
        @if (items().length) {
          <strong>+ Add more videos</strong>
        } @else {
          <strong>Click to choose videos</strong>
          <span>or drag &amp; drop them here</span>
          <small>MP4, WEBM, MOV or MKV, up to 1 GB each — pick two or more</small>
        }
      </label>

      @if (items().length) {
        <p class="step">Play order — drag to reorder, click a name to play it.</p>
        <ol class="items">
          @for (item of items(); track item.id; let i = $index, first = $first, last = $last) {
            <li
              draggable="true"
              [class.drag-over]="dragOver() === i"
              [class.playing]="!showResult() && playingId() === item.id"
              (dragstart)="dragFrom = i"
              (dragover)="onItemDragOver($event, i)"
              (dragleave)="dragOver.set(null)"
              (drop)="onItemDrop($event, i)"
              (dragend)="dragFrom = null; dragOver.set(null)"
            >
              <div class="item-main">
                <button type="button" class="name" [title]="item.name" (click)="play(item.id)">
                  {{ i + 1 }}. {{ item.name }}
                  @if (item.job) {
                    <em>(edited)</em>
                  }
                </button>
                @if (uploads()[item.id]; as u) {
                  @if (u.state === 'uploading') {
                    <progress [value]="u.progress" max="1" [title]="'Uploading ' + (u.progress * 100).toFixed(0) + '%'"></progress>
                  } @else if (u.state === 'failed') {
                    <small class="error">Upload failed — retries when you merge</small>
                  }
                }
              </div>
              <button type="button" class="icon" title="Move up" [disabled]="first || busy()" (click)="move(i, -1)">↑</button>
              <button type="button" class="icon" title="Move down" [disabled]="last || busy()" (click)="move(i, 1)">↓</button>
              <button type="button" class="icon" title="Remove" [disabled]="busy()" (click)="remove(i)">✕</button>
            </li>
          }
        </ol>
        <button type="button" class="link" [disabled]="busy()" (click)="clear()">Remove all</button>
        <small class="total" [class.over]="overCap()">
          Total {{ fsize(totalBytes()) }} of {{ fsize(maxBytes) }} max
          @if (overCap()) {
            — remove or crop a video to merge
          }
        </small>
        <small class="note">Videos with the same format and size join quickly; otherwise they are re-encoded to MP4, which takes longer.</small>
      }

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      @if (items().length) {
        @if (phase() !== 'idle') {
          <p class="step">{{ phase() === 'uploading' ? 'Waiting for the uploads to finish…' : 'Merging on the server…' }}</p>
          <progress [value]="phase() === 'uploading' ? uploadTotal() : progress()" max="1"></progress>
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
        } @else {
          <button type="button" class="primary" [disabled]="items().length < 2 || overCap()" (click)="merge()">
            Merge videos
          </button>
        }
        @if (result(); as r) {
          <a class="download" [attr.href]="r.downloadUrl">Download merged video</a>
          <small class="hint">{{ r.name }} · {{ fsize(r.size) }}</small>
        }
      }
    </section>

    <section class="panel preview video-preview">
      @if (result()) {
        <div class="tabs">
          <button type="button" [class.active]="showResult()" (click)="showResult.set(true)">Merged</button>
          <button type="button" [class.active]="!showResult()" (click)="showResult.set(false)">Selected clip</button>
        </div>
      }
      @if (playingUrl(); as url) {
        <app-video-player [src]="url" />
      } @else {
        <p class="empty">The video plays here</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: contents;
    }
    .drop.small {
      padding: 12px;
    }
    .items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .items li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px;
      background: #f4f6f8;
      border: 1px solid transparent;
      border-radius: 8px;
      cursor: grab;
    }
    .items li.drag-over,
    .items li.playing {
      border-color: #2563eb;
      background: #f3f7ff;
    }
    .item-main {
      flex: 1;
      min-width: 0;
      display: grid;
      gap: 4px;
    }
    .item-main progress {
      width: 100%;
      height: 6px;
    }
    .item-main .error {
      font-size: 0.75rem;
    }
    .items .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: inherit;
      font-size: 0.85rem;
      text-align: left;
      background: none;
      border: 0;
      padding: 4px 0;
      cursor: pointer;
      color: inherit;
    }
    .items .name em {
      color: #2563eb;
      font-style: normal;
    }
    .icon {
      width: 28px;
      height: 28px;
      flex: none;
      border: 1px solid #cfd5dc;
      border-radius: 6px;
      background: #fff;
      cursor: pointer;
      font: inherit;
      line-height: 1;
    }
    .note,
    .total {
      color: #6b7280;
    }
    .total.over {
      color: #b91c1c;
      font-weight: 600;
    }
    progress {
      width: 100%;
    }
  `,
})
export class VideoMergeComponent implements OnDestroy {
  readonly accept = VIDEO_ACCEPT;
  /** The Video crop tool's result (on the server); it goes first in the list. */
  readonly seed = input<VideoResult | null>(null);

  readonly items = signal<Item[]>([]);
  readonly uploads = signal<Record<number, UploadState>>({});
  /** Overall upload progress across the picked files, by size. */
  readonly uploadTotal = computed(() => {
    const files = this.items().filter((it) => it.file);
    const total = files.reduce((s, it) => s + it.file!.size, 0);
    if (!total) return 1;
    return files.reduce((s, it) => s + it.file!.size * (this.uploads()[it.id]?.progress ?? 0), 0) / total;
  });
  readonly maxBytes = MAX_MERGE_BYTES;
  /** The merged video can't be bigger than its inputs together, so they're capped at 2 GB. */
  readonly totalBytes = computed(() => this.items().reduce((s, it) => s + it.size, 0));
  readonly overCap = computed(() => this.totalBytes() > MAX_MERGE_BYTES);
  readonly result = signal<VideoResult | null>(null);
  readonly showResult = signal(false);
  readonly playingId = signal<number | null>(null);
  readonly playingUrl = computed(() => {
    if (this.showResult() && this.result()) return this.result()!.url;
    const items = this.items();
    return (items.find((it) => it.id === this.playingId()) ?? items[0])?.url ?? null;
  });
  readonly phase = signal<'idle' | 'uploading' | 'processing'>('idle');
  readonly busy = computed(() => this.phase() !== 'idle');
  readonly progress = signal(0);
  readonly error = signal('');
  readonly dragging = signal(false);
  readonly dragOver = signal<number | null>(null);
  dragFrom: number | null = null;

  readonly fsize = formatSize;

  private nextId = 0;
  private job: { id: string | null; abort: AbortController } | null = null;

  constructor() {
    // A new crop replaces the previous cropped clip at the top of the list.
    effect(() => {
      const seed = this.seed();
      untracked(() => {
        const old = this.items().find((it) => it.job);
        if (old?.job === seed?.jobId) return;
        const rest = this.items().filter((it) => !it.job);
        this.items.set(seed ? [{ id: this.nextId++, name: seed.name, size: seed.size, url: seed.url, job: seed.jobId }, ...rest] : rest);
        this.changed();
      });
    });
  }

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addFiles(input.files);
    input.value = '';
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.dragFrom === null) this.addFiles(event.dataTransfer?.files);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (this.dragFrom === null) this.dragging.set(true);
  }

  onItemDragOver(event: DragEvent, i: number): void {
    if (this.dragFrom === null || this.busy()) return;
    event.preventDefault();
    this.dragOver.set(i);
  }

  onItemDrop(event: DragEvent, to: number): void {
    if (this.dragFrom === null) return;
    event.preventDefault();
    const from = this.dragFrom;
    this.dragFrom = null;
    this.dragOver.set(null);
    if (from !== to) this.reorder(from, to);
  }

  play(id: number): void {
    this.playingId.set(id);
    this.showResult.set(false);
  }

  move(i: number, by: -1 | 1): void {
    this.reorder(i, i + by);
  }

  remove(i: number): void {
    this.release(this.items()[i]);
    this.items.update((list) => list.filter((_, j) => j !== i));
    this.changed();
  }

  clear(): void {
    this.items().forEach((it) => this.release(it));
    this.items.set([]);
    this.error.set('');
    this.changed();
  }

  async merge(): Promise<void> {
    const items = this.items();
    if (items.length < 2 || this.busy() || this.overCap()) return;
    this.error.set('');
    const job = { id: null as string | null, abort: new AbortController() };
    this.job = job;
    try {
      this.phase.set('uploading');
      items.filter((it) => this.uploads()[it.id]?.state === 'failed').forEach((it) => this.startUpload(it));
      const sources: VideoSource[] = [];
      for (const it of items) sources.push(it.job ? { job: it.job } : { upload: await it.upload! });
      if (job.abort.signal.aborted) return;
      this.phase.set('processing');
      this.progress.set(0);
      job.id = await startMerge(sources, items[0].name);
      if (job.abort.signal.aborted) {
        cancelJob(job.id);
        return;
      }
      const result = await waitForJob(job.id, (p) => this.progress.set(p), job.abort.signal);
      if (this.job !== job) return; // the list changed meanwhile
      this.result.set(result);
      this.showResult.set(true);
    } catch (e) {
      if (!job.abort.signal.aborted) this.error.set(e instanceof Error ? e.message : 'Could not merge these videos.');
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

  ngOnDestroy(): void {
    this.items().forEach((it) => this.release(it));
  }

  private addFiles(list: FileList | File[] | null | undefined): void {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const videos = files.filter((f) => isVideo(f) && f.size <= MAX_VIDEO_BYTES);
    const tooBig = files.filter((f) => isVideo(f) && f.size > MAX_VIDEO_BYTES).map((f) => f.name);
    const notVideo = files.some((f) => !isVideo(f));
    this.error.set(
      [
        notVideo ? 'Only video files can be added — the rest were skipped.' : '',
        tooBig.length ? `Over the 1 GB limit, not added: ${tooBig.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (!videos.length) return;
    const added: Item[] = videos.map((file) => ({
      id: this.nextId++,
      name: file.name,
      size: file.size,
      file,
      url: URL.createObjectURL(file),
    }));
    this.items.update((items) => [...items, ...added]);
    added.forEach((it) => this.startUpload(it));
    this.changed();
  }

  private startUpload(item: Item): void {
    item.abort?.abort();
    item.abort = new AbortController();
    const set = (u: UploadState) => this.uploads.update((m) => ({ ...m, [item.id]: u }));
    set({ state: 'uploading', progress: 0 });
    item.upload = uploadVideo(item.file!, (p) => set({ state: 'uploading', progress: p }), item.abort.signal);
    item.upload.then(
      () => set({ state: 'done', progress: 1 }),
      () => !item.abort!.signal.aborted && set({ state: 'failed', progress: 0 }),
    );
  }

  private release(item: Item | undefined): void {
    if (!item?.file) return;
    item.abort?.abort();
    URL.revokeObjectURL(item.url);
  }

  private reorder(from: number, to: number): void {
    this.items.update((list) => {
      const next = [...list];
      next.splice(to, 0, ...next.splice(from, 1));
      return next;
    });
    this.changed();
  }

  /** The list changed: the merged video no longer matches it. */
  private changed(): void {
    if (this.job) {
      this.job.abort.abort();
      if (this.job.id) cancelJob(this.job.id);
      this.job = null;
      this.phase.set('idle');
    }
    this.result.set(null);
    this.showResult.set(false);
  }
}
