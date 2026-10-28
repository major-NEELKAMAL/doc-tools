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

## Deploy (https://cropresizecompare.risegap.com)

The `Jenkinsfile` ships the source to the test VM (same pipeline as
risegap-admin), builds the image there and runs it on `127.0.0.1:8082`. The
VM's host nginx terminates HTTPS on 443 with the Cloudflare Origin Certificate
(`*.risegap.com`) and routes `cropresizecompare.risegap.com` to that port
(config: `deploy/nginx-risegap.conf` in the risegap-api repo). That host is
also the canonical URL in `index.html`, `robots.txt` and `sitemap.xml`.
Cloudflare: proxied, pointing at the test VM. The internal names
(container, image, Angular project) are still `doc-watermark`.
