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
const jobs = {}; // { jobId: { status, data, error } }

function createJobId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// =========================
// 공통 함수 (기존과 동일)
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
    text.includes('1명'), text.includes('2명'),
    text.includes('3명'), text.includes('4명')
  ];
  if (blockedWords.some(word => text.includes(word))) return false;
  if (blockedPatterns.some(Boolean)) return false;
  return true;
}

async function getReviews(placeId) {
  const reviewUrl = `https://pcmap.place.naver.com/restaurant/${placeId}/review/visitor`;
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
// 핵심: 백그라운드 크롤링 함수
// =========================
async function runCrawl(jobId, keyword) {
  const searchUrl = `https://map.naver.com/p/search/${encodeURIComponent(keyword)}?c=15.00,0,0,0,dh`;
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

    // ✅ 응답을 버퍼에 모아서 나중에 처리 (await 블로킹 제거)
    const responseBuffer = [];

    page.on('response', (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        const isJson = contentType.includes('application/json');
        const isSearchApi = url.includes('/search') || url.includes('/graphql') || url.includes('/list');
        if (!isJson || !isSearchApi) return;

        // ✅ await 없이 Promise만 저장
        responseBuffer.push(
          response.json().then(json => {
            extractPlaces(json, places, visitedPlace);
          }).catch(() => {})
        );
      } catch {}
    });

    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    // ✅ 버퍼에 쌓인 응답 파싱 완료까지 대기
    await Promise.allSettled(responseBuffer);

    // 리뷰 수집
    const allReviews = [];
    for (const place of places) {
      console.log(`\n업체: ${place.name}`);
      try {
        const reviews = await getReviews(place.placeId);
        allReviews.push({ placeId: place.placeId, name: place.name, reviewCount: reviews.length, reviews });
        console.log(reviews);
      } catch {
        console.log(`${place.name} 리뷰 수집 실패`);
      }
    }

    // ✅ 결과 저장
    jobs[jobId] = {
      status: 'done',
      data: { keyword, placeCount: places.length, result: allReviews }
    };

    console.log(`[JOB ${jobId}] 완료 - ${places.length}개 업체`);

  } catch (error) {
    console.error(`[JOB ${jobId}] 실패`, error);
    jobs[jobId] = { status: 'error', error: error.message };

  } finally {
    // ✅ 반드시 정리
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

  // ✅ await 없이 백그라운드 실행
  runCrawl(jobId, keyword);

  // ✅ 즉시 응답 (타임아웃 없음)
  res.json({ success: true, jobId });
});

// =========================
// API: 결과 폴링
// =========================
app.get('/api/review/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ success: false, message: '존재하지 않는 작업입니다.' });
  res.json({ success: true, ...job });
});

// 기존 호환용 (마지막 결과 조회)
app.get('/api/review', (req, res) => {
  const jobIds = Object.keys(jobs);
  if (!jobIds.length) return res.json({ success: true, status: 'idle', data: null });
  const lastJob = jobs[jobIds[jobIds.length - 1]];
  res.json({ success: true, ...lastJob });
});

app.get('/health', (req, res) => res.status(200).send('healthy'));
app.get('/', (req, res) => res.send('OK'));

app.listen(PORT, '0.0.0.0', () => console.log(`SERVER START : ${PORT}`));