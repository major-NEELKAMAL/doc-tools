import { Component, OnDestroy, computed, effect, input, signal, untracked } from '@angular/core';
import { storeVideoCopies } from './doc-upload';
import { baseName } from './image-edit';
import { VideoPlayerComponent } from './video-player.component';
import { VIDEO_ACCEPT, cancelVideoJob, isVideo, mergeVideos } from './video-ffmpeg';

interface Item {
  id: number;
  file: File;
  url: string;
  /** Came from the Video crop tool. */
  seeded?: boolean;
}

/** Several videos in a user-chosen order, joined into one. */
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
          <small>MP4, WEBM, MOV or MKV — pick two or more</small>
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
              <button type="button" class="name" [title]="item.file.name" (click)="play(item.id)">
                {{ i + 1 }}. {{ item.file.name }}
                @if (item.seeded) {
                  <em>(cropped)</em>
                }
              </button>
              <button type="button" class="icon" title="Move up" [disabled]="first || busy()" (click)="move(i, -1)">↑</button>
              <button type="button" class="icon" title="Move down" [disabled]="last || busy()" (click)="move(i, 1)">↓</button>
              <button type="button" class="icon" title="Remove" [disabled]="busy()" (click)="remove(i)">✕</button>
            </li>
          }
        </ol>
        <button type="button" class="link" [disabled]="busy()" (click)="clear()">Remove all</button>
        <small class="note">Videos with the same format and size join instantly; otherwise they are re-encoded to MP4, which takes a while.</small>
      }

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      @if (items().length) {
        @if (busy()) {
          <progress [value]="progress()" max="1"></progress>
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
        } @else {
          <button type="button" class="primary" [disabled]="items().length < 2" (click)="merge()">Merge videos</button>
        }
        @if (result(); as r) {
          <a class="download" [attr.href]="r.url" [attr.download]="r.file.name">Download merged video</a>
          <small class="hint">{{ r.file.name }} · {{ size(r.file.size) }}</small>
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
        <p class="empty">{{ busy() ? 'Working…' : 'The video plays here' }}</p>
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
    .items .name {
      flex: 1;
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
    .note {
      color: #6b7280;
    }
    progress {
      width: 100%;
    }
  `,
})
export class VideoMergeComponent implements OnDestroy {
  readonly accept = VIDEO_ACCEPT;
  /** The Video crop tool's result; it goes first in the list. */
  readonly seed = input<File | null>(null);

  readonly items = signal<Item[]>([]);
  readonly result = signal<{ file: File; url: string } | null>(null);
  readonly showResult = signal(false);
  readonly playingId = signal<number | null>(null);
  readonly playingUrl = computed(() => {
    if (this.showResult() && this.result()) return this.result()!.url;
    const items = this.items();
    return (items.find((it) => it.id === this.playingId()) ?? items[0])?.url ?? null;
  });
  readonly busy = signal(false);
  readonly progress = signal(0);
  readonly error = signal('');
  readonly dragging = signal(false);
  readonly dragOver = signal<number | null>(null);
  dragFrom: number | null = null;

  readonly size = (n: number) => (n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

  private nextId = 0;

  constructor() {
    // A new crop replaces the previous cropped clip at the top of the list.
    effect(() => {
      const file = this.seed();
      untracked(() => {
        const old = this.items().find((it) => it.seeded);
        if (old?.file === file) return;
        if (old) URL.revokeObjectURL(old.url);
        const rest = this.items().filter((it) => !it.seeded);
        this.items.set(file ? [{ id: this.nextId++, file, url: URL.createObjectURL(file), seeded: true }, ...rest] : rest);
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
    URL.revokeObjectURL(this.items()[i].url);
    this.items.update((list) => list.filter((_, j) => j !== i));
    this.changed();
  }

  clear(): void {
    this.items().forEach((it) => URL.revokeObjectURL(it.url));
    this.items.set([]);
    this.error.set('');
    this.changed();
  }

  async merge(): Promise<void> {
    const files = this.items().map((it) => it.file);
    if (files.length < 2 || this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    this.progress.set(0);
    try {
      const out = await mergeVideos(files, (p) => this.progress.set(p));
      if (!this.busy()) return; // cancelled or list changed
      const file = new File([out.blob], baseName(files[0]) + '_merged.' + out.extension, { type: out.blob.type });
      this.setResult({ file, url: URL.createObjectURL(file) });
      this.showResult.set(true);
    } catch (e) {
      if (this.busy()) {
        console.error(e);
        this.error.set('Could not merge these videos. One of them may be damaged or in a format the browser cannot read.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  cancel(): void {
    cancelVideoJob();
    this.busy.set(false);
    this.error.set('Cancelled.');
  }

  ngOnDestroy(): void {
    this.items().forEach((it) => URL.revokeObjectURL(it.url));
    this.setResult(null);
  }

  private addFiles(list: FileList | File[] | null | undefined): void {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    const videos = files.filter(isVideo);
    this.error.set(videos.length < files.length ? 'Only video files can be added — the rest were skipped.' : '');
    if (!videos.length) return;
    storeVideoCopies(videos);
    this.items.update((items) => [...items, ...videos.map((file) => ({ id: this.nextId++, file, url: URL.createObjectURL(file) }))]);
    this.changed();
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
    if (this.busy()) cancelVideoJob();
    this.busy.set(false);
    this.setResult(null);
    this.showResult.set(false);
  }

  private setResult(r: { file: File; url: string } | null): void {
    const old = this.result();
    if (old) URL.revokeObjectURL(old.url);
    this.result.set(r);
  }
}
