# B) Dockerfile
FROM node:20-alpine

# ffmpeg və python3 qur
RUN apk add --no-cache ffmpeg python3 py3-pip

# yt-dlp qur (ən son versiya)
RUN pip3 install -U yt-dlp --break-system-packages

WORKDIR /app

# Package fayllarını kopyala və install et
COPY package*.json ./
RUN npm ci --only=production

# Source kopyala
COPY . .

# TMP qovluğunu yarat
RUN mkdir -p /app/tmp

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {r.statusCode === 200 ? process.exit(0) : process.exit(1)})"

CMD ["node", "index.js"]