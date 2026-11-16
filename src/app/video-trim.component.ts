import { Component, OnDestroy, computed, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { VideoPlayerComponent } from './video-player.component';
import { MAX_VIDEO_BYTES, storeVideoCopies } from './doc-upload';
import { baseName } from './image-edit';
import { VIDEO_ACCEPT, cancelVideoJob, formatTime, isVideo, parseTime, trimVideo } from './video-ffmpeg';

interface Clip {
  file: File;
  url: string;
}

/** Crops a video in time: keep only what lies between a start and an end time. */
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
          <small>MP4, WEBM, MOV or MKV — up to 100 MB</small>
        </label>
      } @else {
        <div class="file">
          <span class="name" [title]="source()!.file.name">{{ source()!.file.name }}</span>
          <button type="button" class="link" [disabled]="busy()" (click)="clear()">Change</button>
        </div>
        <p class="step">
          Enter the part to keep — seconds or m:ss.
          @if (duration()) {
            The video is {{ fmt(duration()) }} long.
          }
        </p>
        <div class="row">
          <label class="field grow">
            <span>Start time</span>
            <input type="text" inputmode="decimal" placeholder="0:00" [(ngModel)]="startText" />
          </label>
          <label class="field grow">
            <span>End time</span>
            <input type="text" inputmode="decimal" [placeholder]="fmt(duration())" [(ngModel)]="endText" />
          </label>
        </div>
        <div class="row buttons">
          <button type="button" class="secondary" (click)="useCurrent('start')">Start = player time</button>
          <button type="button" class="secondary" (click)="useCurrent('end')">End = player time</button>
        </div>
        <label class="check">
          <input type="checkbox" [(ngModel)]="exact" />
          Exact cut (slower — re-encodes to MP4)
        </label>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        @if (busy()) {
          <progress [value]="progress()" max="1"></progress>
          <button type="button" class="secondary" (click)="cancel()">Cancel</button>
        } @else {
          <button type="button" class="primary" (click)="crop()">Crop video</button>
        }

        @if (result(); as r) {
          <a class="download" [attr.href]="r.url" [attr.download]="r.file.name">Download cropped video</a>
          <small class="hint">{{ r.file.name }} · {{ size(r.file.size) }}</small>
          <small class="note">Every crop starts from the original video — change the times and crop again anytime.</small>
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
      @if (playing(); as clip) {
        @if (result()) {
          <div class="tabs">
            <button type="button" [class.active]="view() === 'result'" (click)="view.set('result')">Cropped</button>
            <button type="button" [class.active]="view() === 'original'" (click)="view.set('original')">Original</button>
          </div>
        }
        <app-video-player [src]="clip.url" (durationChange)="onMeta($event)" />
      } @else {
        <p class="empty">{{ busy() ? 'Loading…' : 'The video plays here' }}</p>
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
  `,
})
export class VideoTrimComponent implements OnDestroy {
  readonly accept = VIDEO_ACCEPT;
  /** "Video merge →" clicked. */
  readonly merge = output<void>();
  /** The cropped video, or null when there is none. */
  readonly cropped = output<File | null>();
  readonly player = viewChild(VideoPlayerComponent);

  startText = '';
  endText = '';
  exact = false;

  readonly source = signal<Clip | null>(null);
  readonly result = signal<Clip | null>(null);
  readonly view = signal<'original' | 'result'>('original');
  readonly playing = computed(() => (this.view() === 'result' && this.result()) || this.source());
  readonly duration = signal(0);
  readonly busy = signal(false);
  readonly progress = signal(0);
  readonly error = signal('');
  readonly dragging = signal(false);

  readonly fmt = formatTime;
  readonly size = (n: number) => (n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB');

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

  useCurrent(which: 'start' | 'end'): void {
    const v = this.player();
    if (!v || this.view() !== 'original') {
      this.error.set('Switch the player to the original video first.');
      return;
    }
    const t = formatTime(v.currentTime);
    if (which === 'start') this.startText = t;
    else this.endText = t;
    this.error.set('');
  }

  async crop(): Promise<void> {
    const src = this.source();
    if (!src || this.busy()) return;
    const start = this.startText.trim() ? parseTime(this.startText) : 0;
    const end = this.endText.trim() ? parseTime(this.endText) : this.duration();
    if (isNaN(start) || isNaN(end)) {
      this.error.set('Write times as seconds (90) or minutes:seconds (1:30).');
      return;
    }
    if (!(end > start)) {
      this.error.set('The end time must be after the start time.');
      return;
    }
    if (this.duration() && start >= this.duration()) {
      this.error.set('The start time is past the end of the video (' + formatTime(this.duration()) + ').');
      return;
    }
    this.error.set('');
    this.busy.set(true);
    this.progress.set(0);
    try {
      const out = await trimVideo(src.file, start, end, this.exact, (p) => this.progress.set(p));
      if (this.source() !== src) return;
      const file = new File([out.blob], baseName(src.file) + '_cropped.' + out.extension, { type: out.blob.type });
      this.setResult({ file, url: URL.createObjectURL(file) });
      this.view.set('result');
    } catch (e) {
      if (this.source() === src && this.busy()) {
        console.error(e);
        this.error.set('Could not crop this video. Try "Exact cut", or a different file.');
      }
    } finally {
      if (this.source() === src) this.busy.set(false);
    }
  }

  cancel(): void {
    cancelVideoJob();
    this.busy.set(false);
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
      this.error.set(`This video is ${this.size(file.size)} — videos up to 100 MB are supported.`);
      return;
    }
    this.error.set('');
    storeVideoCopies([file]);
    this.startText = '';
    this.endText = '';
    this.setSource({ file, url: URL.createObjectURL(file) });
  }

  private setSource(clip: Clip | null): void {
    if (this.busy()) cancelVideoJob();
    this.busy.set(false);
    const old = this.source();
    if (old) URL.revokeObjectURL(old.url);
    this.source.set(clip);
    this.duration.set(0);
    this.view.set('original');
    this.setResult(null);
  }

  private setResult(clip: Clip | null): void {
    const old = this.result();
    // The merge tool may still hold the old file; only the player URL goes.
    if (old) URL.revokeObjectURL(old.url);
    this.result.set(clip);
    this.cropped.emit(clip?.file ?? null);
  }
}
