import { Component, ElementRef, effect, input, output, signal, viewChild } from '@angular/core';
import { formatTime } from './video-api';

/** A video with its own control bar: play/pause, seek, skip, volume (min/max/mute), speed, fullscreen. */
@Component({
  selector: 'app-video-player',
  standalone: true,
  template: `
    <div class="player" #box>
      <video
        #video
        [src]="src()"
        playsinline
        preload="metadata"
        (click)="toggle()"
        (play)="paused.set(false)"
        (pause)="paused.set(true)"
        (ended)="paused.set(true)"
        (timeupdate)="time.set(video.currentTime)"
        (loadedmetadata)="onMeta()"
        (volumechange)="volume.set(video.volume); muted.set(video.muted)"
      ></video>
      <div class="bar">
        <input
          class="seek"
          type="range"
          min="0"
          [max]="duration() || 0"
          step="0.01"
          [value]="time()"
          (input)="seek(+$any($event.target).value)"
          aria-label="Seek"
        />
        <div class="buttons">
          <button type="button" (click)="skip(-5)" title="Back 5 s" aria-label="Back 5 seconds">⏪</button>
          <button type="button" class="play" (click)="toggle()" [title]="paused() ? 'Play' : 'Pause'">
            {{ paused() ? '▶' : '⏸' }}
          </button>
          <button type="button" (click)="skip(5)" title="Forward 5 s" aria-label="Forward 5 seconds">⏩</button>
          <span class="time">{{ fmt(time()) }} / {{ fmt(duration()) }}</span>
          <span class="spacer"></span>
          <span class="group volume">
            <button type="button" (click)="toggleMute()" [title]="muted() || !volume() ? 'Unmute' : 'Mute'">
              {{ muted() || !volume() ? '🔇' : volume() < 0.5 ? '🔉' : '🔊' }}
            </button>
            <button type="button" class="txt" (click)="setVolume(0)" title="Minimum volume">Min</button>
            <input
              class="vol"
              type="range"
              min="0"
              max="1"
              step="0.05"
              [value]="muted() ? 0 : volume()"
              (input)="setVolume(+$any($event.target).value)"
              aria-label="Volume"
            />
            <button type="button" class="txt" (click)="setVolume(1)" title="Maximum volume">Max</button>
          </span>
          <span class="group">
            <select (change)="setRate(+$any($event.target).value)" title="Playback speed">
              @for (r of rates; track r) {
                <option [value]="r" [selected]="r === rate()">{{ r }}×</option>
              }
            </select>
            <button type="button" (click)="fullscreen()" title="Fullscreen" aria-label="Fullscreen">⛶</button>
          </span>
        </div>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }
    .player {
      background: #000;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 2px 10px rgb(0 0 0 / 15%);
    }
    .player:fullscreen {
      display: flex;
      flex-direction: column;
      border-radius: 0;
    }
    video {
      display: block;
      width: 100%;
      max-height: 65vh;
      background: #000;
      cursor: pointer;
    }
    .player:fullscreen video {
      flex: 1;
      max-height: none;
    }
    .bar {
      padding: 6px 10px 8px;
      background: #111827;
      color: #e5e7eb;
    }
    .seek {
      width: 100%;
      margin: 0 0 4px;
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
    button,
    select {
      min-width: 32px;
      height: 30px;
      border: 0;
      border-radius: 6px;
      background: #1f2937;
      color: inherit;
      font: inherit;
      font-size: 0.9rem;
      cursor: pointer;
    }
    button:hover,
    select:hover {
      background: #374151;
    }
    .play {
      min-width: 40px;
    }
    .txt {
      padding: 0 8px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .time {
      font-size: 0.8rem;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .spacer {
      flex: 1;
    }
    /* Volume and speed/fullscreen each wrap as one unit on narrow screens. */
    .group {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .volume {
      flex: 1 1 220px;
      max-width: 260px;
    }
    .vol {
      flex: 1;
      min-width: 50px;
    }
  `,
})
export class VideoPlayerComponent {
  readonly src = input.required<string>();
  /** Duration once the metadata is in. */
  readonly durationChange = output<number>();

  readonly video = viewChild.required<ElementRef<HTMLVideoElement>>('video');
  readonly box = viewChild.required<ElementRef<HTMLElement>>('box');

  readonly rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  readonly paused = signal(true);
  readonly time = signal(0);
  readonly duration = signal(0);
  readonly volume = signal(1);
  readonly muted = signal(false);
  readonly rate = signal(1);
  readonly fmt = formatTime;

  constructor() {
    // A new source starts from the beginning, paused.
    effect(
      () => {
        this.src();
        this.paused.set(true);
        this.time.set(0);
        this.duration.set(0);
      },
      { allowSignalWrites: true },
    );
  }

  /** Where the playhead is, in seconds. */
  get currentTime(): number {
    return this.video().nativeElement.currentTime;
  }

  onMeta(): void {
    const v = this.video().nativeElement;
    v.playbackRate = this.rate();
    v.volume = this.volume();
    v.muted = this.muted();
    const d = isFinite(v.duration) ? v.duration : 0;
    this.duration.set(d);
    this.durationChange.emit(d);
  }

  toggle(): void {
    const v = this.video().nativeElement;
    if (v.paused || v.ended) v.play().catch(() => undefined);
    else v.pause();
  }

  seek(t: number): void {
    this.video().nativeElement.currentTime = t;
    this.time.set(t);
  }

  skip(by: number): void {
    const v = this.video().nativeElement;
    this.seek(Math.min(Math.max(0, v.currentTime + by), this.duration() || v.currentTime + by));
  }

  setVolume(vol: number): void {
    const v = this.video().nativeElement;
    v.volume = vol;
    v.muted = vol === 0;
  }

  toggleMute(): void {
    const v = this.video().nativeElement;
    if (v.muted || v.volume === 0) {
      if (v.volume === 0) v.volume = 1;
      v.muted = false;
    } else {
      v.muted = true;
    }
  }

  setRate(r: number): void {
    this.rate.set(r);
    this.video().nativeElement.playbackRate = r;
  }

  fullscreen(): void {
    const box = this.box().nativeElement;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else box.requestFullscreen?.().catch(() => undefined);
  }
}
