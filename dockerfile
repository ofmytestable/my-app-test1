# Playwright 공식 이미지 사용 (시스템 라이브러리 모두 포함)
FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Playwright 브라우저 설치 (이미지 안에 이미 라이브러리가 있으므로 성공)
RUN npx playwright install chromium

COPY . .

EXPOSE 3000
CMD ["npm", "start"]