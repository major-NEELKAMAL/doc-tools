# Document Watermark

Upload an image (JPG/PNG/WEBP) or PDF, then crop, rotate and stamp a watermark like
"FOR MCA REGISTRATION ONLY" on it, preview it, and download it.

All processing happens in the browser (canvas for images, pdf-lib for PDFs) —
files are never sent to the server.

## Run with Docker

    docker compose up -d --build     # http://localhost:8090
    docker compose down

## Develop

    npm install
    npx ng serve                     # http://localhost:4200

## Deploy (https://crop.risegap.com)

The `Jenkinsfile` ships the source to the test VM (same pipeline as
risegap-admin), builds the image there and runs it on `127.0.0.1:8082`. The
VM's host nginx terminates HTTPS on 443 with the Cloudflare Origin Certificate
(`*.risegap.com`) and routes `crop.risegap.com` to that port (config:
`deploy/nginx-risegap.conf` in the risegap-api repo). Cloudflare:
`crop.risegap.com` proxied, A record -> the test VM.
