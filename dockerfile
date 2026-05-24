FROM cloudtype/node:24

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# 브라우저 저장 위치 고정
ENV PLAYWRIGHT_BROWSERS_PATH=/app/playwright

# chromium 설치
RUN npx playwright install chromium

CMD ["node", "server.js"]