FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 py3-pip curl unzip bash
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
RUN pip3 install -U yt-dlp --break-system-packages

WORKDIR /app
COPY package.json ./
RUN npm install --no-package-lock
COPY . .
RUN mkdir -p /tmp/video-downloader /tmp/yt-cookies

EXPOSE 3000
CMD ["node", "index.js"]
