const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { chromium } = require('playwright');
const path = require('path');

const app = express();

app.use(cors());

// 정적 폴더 연결
app.use(express.static(path.join(__dirname, 'public')));


// =========================
// 서버 설정
// =========================
app.get("/", (req, res) => {
  res.send("OK");
});

app.get("/health", (req, res) => {
  res.status(200).send("healthy");
});

const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  res.setTimeout(120000); // 2분
  next();
});

// =========================
// 전역 결과 저장
// =========================
let latestResult = {
  keyword: '',
  placeCount: 0,
  result: []
};

// =========================
// 공통 함수
// =========================
async function getHtml(url) {
  const response = await axios.get(url);
  return response.data;
}

// 리뷰 텍스트 정리
function cleanReviewText(text) {
  if (!text) return false;

  const blockedWords = [
    '팔로우',
    '펼쳐보기',
    '반응 남기기'
  ];

  const blockedPatterns = [
    text.includes('리뷰') && text.includes('사진'),
    text.includes('1명'),
    text.includes('2명'),
    text.includes('3명'),
    text.includes('4명')
  ];

  if (blockedWords.some(word => text.includes(word))) {
    return false;
  }

  if (blockedPatterns.some(Boolean)) {
    return false;
  }

  return true;
}

// 리뷰 수집
async function getReviews(placeId) {
  const reviewUrl =
    `https://pcmap.place.naver.com/restaurant/${placeId}/review/visitor`;

  const html = await getHtml(reviewUrl);

  const $ = cheerio.load(html);

  const reviews = [];

  $('a.pui__GStJHb').each((i, el) => {
    const text = $(el).text().trim();

    if (cleanReviewText(text)) {
      reviews.push(text);
    }
  });

  return reviews;
}

// JSON 내부 place 추출
function extractPlaces(obj, places, visitedPlace) {
  if (!obj) return;

  if (Array.isArray(obj)) {
    obj.forEach(item =>
      extractPlaces(item, places, visitedPlace)
    );
    return;
  }

  if (typeof obj === 'object') {

    if (
      obj.id &&
      obj.name &&
      /^\d+$/.test(String(obj.id))
    ) {
      const placeId = String(obj.id);

      if (!visitedPlace.has(placeId)) {

        visitedPlace.add(placeId);

        places.push({
          placeId,
          name: obj.name
        });

        console.log(`[PLACE] ${placeId} / ${obj.name}`);
      }
    }

    for (const key in obj) {
      extractPlaces(
        obj[key],
        places,
        visitedPlace
      );
    }
  }
}

// =========================
// 검색 API
// =========================
app.get('/search', async (req, res) => {

  const keyword = req.query.keyword;

  if (!keyword) {
    return res.status(400).json({
      success: false,
      message: 'keyword가 필요합니다.'
    });
  }

  const searchUrl =
    `https://map.naver.com/p/search/${encodeURIComponent(keyword)}?c=15.00,0,0,0,dh`;

  let browser;
  let page;

  try {

    browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
      headless: true,
    });

    page = await browser.newPage();
    const places = [];
    const visitedPlace = new Set();

    // =========================
    // 검색 응답 감지
    // =========================
    page.on('response', async (response) => {

      try {

        const url = response.url();

        const contentType =
          response.headers()['content-type'] || '';

        const isJson =
          contentType.includes('application/json');

        const isSearchApi =
          url.includes('/search') ||
          url.includes('/graphql') ||
          url.includes('/list');

        if (!isJson || !isSearchApi) {
          return;
        }

        let json;

        try {
          json = await response.json();
        } catch {
          return;
        }

        extractPlaces(
          json,
          places,
          visitedPlace
        );

      } catch (error) {
        console.log('response parse error');
      }

    });

    // =========================
    // 검색 페이지 접속
    // =========================
    await page.goto(searchUrl);

    await page.waitForSelector('body');

    // API 응답 수집 대기
    await page.waitForTimeout(7000);

    // =========================
    // 리뷰 수집
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

        console.log(
          `${place.name} 리뷰 수집 실패`
        );

      }

    }

    // 결과 저장
    latestResult = {
      keyword,
      placeCount: places.length,
      result: allReviews
    };

    // 응답
    res.json({
      success: true,
      data: latestResult
    });

  } catch (error) {

  console.error(error);

  res.status(500).json({
    success: false,
    message: '요청 실패'
  });

  } finally {
  
    try {
      if (page && !page.isClosed()) {
       await page.close();
      }
    } catch {}
  
    try {
      if (browser) {
        await browser.close();
      }
    } catch {}

  }

});

// =========================
// 최근 결과 조회 API
// =========================
app.get('/api/review', (req, res) => {

  res.json({
    success: true,
    data: latestResult
  });

});

// =========================
// 서버 실행
// =========================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SERVER START : ${PORT}`);
});