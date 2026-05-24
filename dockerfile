FROM mcr.microsoft.com/playwright:v1.60.0-jammy

USER root

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3000
CMD ["node", "server.js"]