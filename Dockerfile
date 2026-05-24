# Dockerfile
FROM node:20-alpine

# Sistem paketləri
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    py3-pip \
    curl \
    unzip \
    bash \
    wget \
    ca-certificates

# Deno (Invidious API üçün)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# yt-dlp quraşdır
RUN pip3 install -U yt-dlp --break-system-packages

# yt-dlp versiyasını yoxla
RUN yt-dlp --version

# FFmpeg versiyasını yoxla
RUN ffmpeg -version | head -1

# İş qovluğu
WORKDIR /app

# package.json kopyala və dependencies quraşdır
COPY package.json ./
RUN npm install --no-package-lock --production

# Bütün faylları kopyala
COPY . .

# Tmp qovluqları yarat
RUN mkdir -p /tmp/video-downloader /tmp/audio-downloader /tmp/yt-cookies /tmp/tiktok-cookies

# İcazələri təyin et
RUN chmod -R 777 /tmp/video-downloader /tmp/audio-downloader /tmp/yt-cookies /tmp/tiktok-cookies

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Port
EXPOSE 3000

# Başlat
CMD ["node", "index.js"]