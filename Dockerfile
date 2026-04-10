FROM node:20-alpine
RUN apk add --no-cache ffmpeg python3 py3-pip curl unzip bash

# Deno quraşdır
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# yt-dlp ən son versiya
RUN pip3 install -U yt-dlp --break-system-packages

WORKDIR /app
COPY package*.json ./
RUN rm -f package-lock.json && npm install --legacy-peer-deps

COPY . .
RUN mkdir -p /tmp/video-downloader /tmp/yt-cookies

# Render üçün PORT environment variable
ENV PORT=10000

EXPOSE ${PORT}
CMD ["node", "index.js"]
