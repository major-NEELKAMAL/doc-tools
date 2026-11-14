# Document Tools

- **Crop / Watermark** — upload an image (JPG/PNG/WEBP) or PDF, then crop, rotate and
  stamp a watermark on it, preview it, and download it. Images can also be
  resized to a pixel size and/or squeezed under a file size (e.g. 20 KB, 100 KB).
- **Combine images** — stack several images top to bottom (drag to reorder) into
  one image or a one-page PDF.
- **Images to PDF** — one PDF page per image, sized to the image or A4.
- **Text compare** — paste or upload two texts and see the line diff, side by
  side or unified (ngx-diff).

A combined result can be sent straight to the watermark tool.

All processing happens in the browser (canvas for images, pdf-lib for PDFs) —
files are never sent to the server.

## Run with Docker

    docker compose up -d --build     # http://localhost:8090
    docker compose down

## Develop

    npm install
    npx ng serve                     # http://localhost:4200

## Deploy (https://www.image-picture.com)

Cloudflare Workers static assets, configured in `wrangler.jsonc`. Cloudflare
builds every push to `main` (`npm run build`, then `npx wrangler deploy`) and
serves `dist/doc-watermark/browser`, sending unknown paths to `index.html`.
Response headers come from `public/_headers`. `image-picture.com` gets a 301
redirect to `www` (a Cloudflare Redirect Rule), and Always Use HTTPS is on.
`www.image-picture.com` is the canonical URL in `index.html`, `robots.txt` and
`sitemap.xml`. The Dockerfile and nginx config are kept only for running the
app locally. The internal names (Angular project, image) are still `doc-watermark`.
