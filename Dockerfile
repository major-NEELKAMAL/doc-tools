# Document Watermark - Angular, served by nginx.
# Stage 1 builds the app; stage 2 is just nginx with the built files.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx ng build

FROM nginx:1.27-alpine
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/doc-watermark/browser /usr/share/nginx/html
EXPOSE 8080
