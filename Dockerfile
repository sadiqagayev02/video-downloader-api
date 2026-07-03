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

# yt-dlp quraşdır (SON VERSİYA)
RUN pip3 install -U yt-dlp --break-system-packages

# Versiyaları yoxla
RUN yt-dlp --version
RUN ffmpeg -version | head -1

WORKDIR /app

COPY package.json ./
RUN npm install --no-package-lock --production

COPY . .

RUN mkdir -p /tmp/video-downloader /tmp/audio-downloader /tmp/yt-cookies /tmp/tiktok-cookies
RUN chmod -R 777 /tmp/video-downloader /tmp/audio-downloader /tmp/yt-cookies /tmp/tiktok-cookies

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# ═══════════════════════════════════════════════════════════════
# DƏYİŞİKLİK: Hər startda yt-dlp-ni yenilə (background-da)
# ═══════════════════════════════════════════════════════════════
CMD sh -c "yt-dlp -U 2>/dev/null & node index.js"
