FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# root로 실행 (Cloudtype 컨테이너 권한 문제 방지)
USER root

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# 브라우저 경로를 공식 이미지 경로로 고정
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3000
CMD ["node", "server.js"]