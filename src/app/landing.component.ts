import { Component, output } from '@angular/core';

/** The tools a landing card can open (same ids as AppComponent's Tool). */
export type LandingTool = 'watermark' | 'combine' | 'pdf' | 'text';

interface Card {
  tool: LandingTool;
  icon: string;
  title: string;
  text: string;
}

interface Faq {
  q: string;
  a: string;
}

/**
 * Landing content above the tools: what the tools do, how
 * they work, and an FAQ. Keep the FAQ in sync with the FAQPage JSON-LD in
 * index.html — Google wants the structured data to match the visible text.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  template: `
    <section class="hero">
      <h1>Crop, resize &amp; compare — free, in your browser</h1>
      <p class="lead">
        Crop and rotate photos, reduce an image to 20 KB, 50 KB or 100 KB, watermark Aadhaar or PAN copies, merge
        images into a PDF and compare two texts side by side. No sign-up, no limits.
      </p>
      <div class="hero-actions">
        <button type="button" class="primary" (click)="open.emit('watermark')">Crop or resize an image</button>
        <button type="button" class="secondary" (click)="open.emit('text')">Compare text</button>
      </div>
    </section>

    <section class="cards" aria-label="Tools">
      @for (c of cards; track c.title) {
        <button type="button" class="card" (click)="open.emit(c.tool)">
          <span class="icon" aria-hidden="true">{{ c.icon }}</span>
          <h2>{{ c.title }}</h2>
          <p>{{ c.text }}</p>
          <span class="go">Open →</span>
        </button>
      }
    </section>

    <section class="steps" aria-label="How it works">
      <h2>How it works</h2>
      <ol>
        <li><strong>Pick a file</strong> — a JPG, PNG, WEBP image, a PDF, or plain text.</li>
        <li><strong>Edit it</strong> — crop, rotate, resize, watermark, combine or compare, with a live preview.</li>
        <li><strong>Download</strong> — save the finished file to your phone or computer. A copy of the file you opened is kept for 30 days (<a href="/privacy.html">privacy policy</a>).</li>
      </ol>
    </section>

    <section class="faq" aria-label="Frequently asked questions">
      <h2>Frequently asked questions</h2>
      @for (f of faqs; track f.q) {
        <details>
          <summary>{{ f.q }}</summary>
          <p>{{ f.a }}</p>
        </details>
      }
    </section>
  `,
})
export class LandingComponent {
  readonly open = output<LandingTool>();

  readonly cards: Card[] = [
    {
      tool: 'watermark',
      icon: '✂️',
      title: 'Crop & rotate images',
      text: 'Cut a photo, ID card or document to exactly the area you need and straighten it.',
    },
    {
      tool: 'watermark',
      icon: '📉',
      title: 'Resize image to 20 KB, 50 KB, 100 KB',
      text: 'Shrink a photo or signature to a file size or pixel size for exam and job forms.',
    },
    {
      tool: 'watermark',
      icon: '💧',
      title: 'Watermark Aadhaar, PAN & documents',
      text: 'Stamp "for verification only" text and the date on ID copies and PDFs before you share them.',
    },
    {
      tool: 'combine',
      icon: '🧩',
      title: 'Combine images',
      text: 'Stack the front and back of a card, or several photos, into one image or one-page PDF.',
    },
    {
      tool: 'pdf',
      icon: '📄',
      title: 'Images to PDF',
      text: 'Turn photos and scans into a single PDF, one page per image, at image size or A4.',
    },
    {
      tool: 'text',
      icon: '🔍',
      title: 'Text compare',
      text: 'Paste or upload two texts and see every added, removed and changed line side by side.',
    },
  ];

  readonly faqs: Faq[] = [
    {
      q: 'Are my files stored?',
      a: 'Yes. A copy of each file you open is uploaded and kept in encrypted storage on our servers for 30 days, then deleted automatically. The editing itself happens in your browser. See the privacy policy for details.',
    },
    {
      q: 'How do I reduce a photo to 20 KB, 50 KB or 100 KB?',
      a: 'Open Crop / Watermark, choose your image, go to the Resize tab and pick a size such as 20 KB, 50 KB or 100 KB. The tool lowers the quality and, if needed, the pixel size until the file fits, then you download it.',
    },
    {
      q: 'Can I resize an image to exact pixels?',
      a: 'Yes. In the Resize tab enter the width and height in pixels. Keep aspect ratio on to avoid stretching the image.',
    },
    {
      q: 'Is it free?',
      a: 'Yes, all tools are free to use with no sign-up and no watermark of ours added to your files.',
    },
    {
      q: 'How do I compare two texts?',
      a: 'Open Text compare, paste or upload the original and the changed text, and click Compare to see the differences side by side or in one unified view.',
    },
  ];
}
