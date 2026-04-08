FROM node:20-alpine

RUN apk add --no-cache ffmpeg python3 py3-pip
RUN pip3 install -U yt-dlp --break-system-packages

WORKDIR /app
COPY package*.json ./
RUN npm install --only=production   # <-- BU SATIR DƏYİŞDİ

COPY . .
RUN mkdir -p /app/tmp

EXPOSE 3000
CMD ["node", "index.js"]
