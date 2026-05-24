FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Playwright 브라우저는 베이스 이미지에 이미 포함되어 있으므로
# npx playwright install 불필요
COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3000
CMD ["node", "server.js"]