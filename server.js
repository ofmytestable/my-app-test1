const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// =========================
// 작업 상태 저장소
// =========================
const jobs = {};

function createJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// =========================
// 공통 함수 (원본 그대로)
// =========================
async function getHtml(url) {
  const response = await axios.get(url);
  return response.data;
}

function cleanReviewText(text) {
  if (!text) return false;
  const blockedWords = ['팔로우', '펼쳐보기', '반응 남기기'];
  const blockedPatterns = [
    text.includes('리뷰') && text.includes('사진'),
    text.includes('1명'),
    text.includes('2명'),
    text.includes('3명'),
    text.includes('4명')
  ];
  if (blockedWords.some(word => text.includes(word))) return false;
  if (blockedPatterns.some(Boolean)) return false;
  return true;
}

async function getReviews(placeId) {
  const reviewUrl =
    `https://pcmap.place.naver.com/restaurant/${placeId}/review/visitor`;
  const html = await getHtml(reviewUrl);
  const $ = cheerio.load(html);
  const reviews = [];
  $('a.pui__GStJHb').each((i, el) => {
    const text = $(el).text().trim();
    if (cleanReviewText(text)) reviews.push(text);
  });
  return reviews;
}

function extractPlaces(obj, places, visitedPlace) {
  if (!obj) return;
  if (Array.isArray(obj)) {
    obj.forEach(item => extractPlaces(item, places, visitedPlace));
    return;
  }
  if (typeof obj === 'object') {
    if (obj.id && obj.name && /^\d+$/.test(String(obj.id))) {
      const placeId = String(obj.id);
      if (!visitedPlace.has(placeId)) {
        visitedPlace.add(placeId);
        places.push({ placeId, name: obj.name });
        console.log(`[PLACE] ${placeId} / ${obj.name}`);
      }
    }
    for (const key in obj) extractPlaces(obj[key], places, visitedPlace);
  }
}

// =========================
// 백그라운드 크롤링 함수
// ★ 원본과 구조 동일, 타이밍 문제만 수정
// =========================
async function runCrawl(jobId, keyword) {
  const searchUrl =
    `https://map.naver.com/p/search/${encodeURIComponent(keyword)}?c=15.00,0,0,0,dh`;

  let browser;
  let page;

  try {
    jobs[jobId].status = 'running';

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--mute-audio',
        '--no-first-run',
        '--disable-application-cache',
        '--disk-cache-size=0',
      ]
    });

    page = await browser.newPage();
    const places = [];
    const visitedPlace = new Set();

    // ★ 핵심 수정: Promise 버퍼 방식 → 원본처럼 직접 await 방식으로 복원
    //   단, 이벤트 핸들러 내부 에러가 조용히 삼켜지지 않도록 try/catch 추가
    page.on('response', async (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        const isJson = contentType.includes('application/json');
        const isSearchApi =
          url.includes('/search') ||
          url.includes('/graphql') ||
          url.includes('/list');

        if (!isJson || !isSearchApi) return;

        let json;
        try {
          json = await response.json();
        } catch {
          return;
        }

        extractPlaces(json, places, visitedPlace);

      } catch (error) {
        console.log('[response handler error]', error.message);
      }
    });

    // ★ 핵심 수정: goto 옵션을 원본과 동일하게 복원
    //   networkidle 대신 domcontentloaded + 충분한 대기시간 유지
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    await page.locator('body').waitFor({
      state: 'attached',
      timeout: 60000,
    });

    // ★ 핵심 수정: 대기 시간을 7초 → 10초로 늘려서
    //   응답 이벤트가 모두 처리될 시간 확보
    await page.waitForTimeout(10000);

    // =========================
    // 리뷰 수집 (원본 그대로)
    // =========================
    const allReviews = [];

    for (const place of places) {
      console.log('\n====================');
      console.log(`업체: ${place.name}`);
      console.log('====================');

      try {
        const reviews = await getReviews(place.placeId);
        allReviews.push({
          placeId: place.placeId,
          name: place.name,
          reviewCount: reviews.length,
          reviews
        });
        console.log(reviews);
      } catch (error) {
        console.log(`${place.name} 리뷰 수집 실패`);
      }
    }

    jobs[jobId] = {
      status: 'done',
      data: {
        keyword,
        placeCount: places.length,
        result: allReviews
      }
    };

    console.log(`[JOB ${jobId}] 완료 - ${places.length}개 업체`);

  } catch (error) {
    console.error(`[JOB ${jobId}] 실패`, error);
    jobs[jobId] = { status: 'error', error: error.message };

  } finally {
    try { if (page && !page.isClosed()) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }
}

// =========================
// API: 크롤링 시작 → 즉시 jobId 반환
// =========================
app.get('/search', (req, res) => {
  const keyword = req.query.keyword;
  if (!keyword) {
    return res.status(400).json({ success: false, message: 'keyword가 필요합니다.' });
  }

  const jobId = createJobId();
  jobs[jobId] = { status: 'pending' };

  runCrawl(jobId, keyword); // await 없이 백그라운드 실행

  res.json({ success: true, jobId });
});

// =========================
// API: 결과 폴링
// =========================
app.get('/api/review/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) {
    return res.status(404).json({ success: false, message: '존재하지 않는 작업입니다.' });
  }
  res.json({ success: true, ...job });
});

app.get('/health', (req, res) => res.status(200).send('healthy'));
app.get('/', (req, res) => res.send('OK'));

app.listen(PORT, '0.0.0.0', () => console.log(`SERVER START : ${PORT}`));