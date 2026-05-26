const searchBtn = document.getElementById('searchBtn');
const keywordInput = document.getElementById('keyword');
const resultDiv = document.getElementById('result');
const loadingDiv = document.getElementById('loading');

let pollInterval = null;

searchBtn.addEventListener('click', search);

async function search() {
  const keyword = keywordInput.value.trim();
  if (!keyword) {
    alert('검색어를 입력해주세요.');
    return;
  }

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  resultDiv.innerHTML = '';
  loadingDiv.textContent = '수집 준비 중...';  // ← 직접 textContent 변경
  loadingDiv.classList.remove('hidden');
  searchBtn.disabled = true;

  try {
    const res = await fetch(`/search?keyword=${encodeURIComponent(keyword)}`);
    const json = await res.json();

    if (!json.success) {
      stop('요청에 실패했습니다.');
      return;
    }

    const { jobId } = json;

    pollInterval = setInterval(async () => {
      try {
        const pollRes = await fetch(`/api/review/${jobId}`);
        const pollJson = await pollRes.json();

        if (pollJson.status === 'done') {
          clearPoll();
          render(pollJson.data);

        } else if (pollJson.status === 'error') {
          stop('크롤링 중 오류가 발생했습니다: ' + (pollJson.error || '알 수 없는 오류'));

        } else {
          // pending / running
          loadingDiv.textContent =
            pollJson.status === 'running' ? '리뷰 수집 중...' : '수집 준비 중...';
        }

      } catch (e) {
        stop('결과를 가져오는 중 오류가 발생했습니다.');
        console.error(e);
      }
    }, 3000);

  } catch (error) {
    stop('서버 연결에 실패했습니다.');
    console.error(error);
  }
}

// 폴링 종료 + UI 초기화
function clearPoll() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  loadingDiv.classList.add('hidden');
  searchBtn.disabled = false;
}

// 에러 시 종료
function stop(message) {
  clearPoll();
  alert(message);
}

function render(data) {
  resultDiv.innerHTML = '';

  if (!data || !data.result || data.result.length === 0) {
    resultDiv.innerHTML = '<p style="color: var(--color-text-secondary)">검색 결과가 없습니다.</p>';
    return;
  }

  data.result.forEach(place => {
    const card = document.createElement('div');
    card.className = 'card';

    let html = `
      <h2>${place.name}</h2>
      <p>리뷰 수: ${place.reviewCount}개</p>
    `;

    if (place.reviews.length === 0) {
      html += `<p class="no-review">수집된 리뷰가 없습니다.</p>`;
    } else {
      place.reviews.forEach(review => {
        html += `<div class="review">${review}</div>`;
      });
    }

    card.innerHTML = html;
    resultDiv.appendChild(card);
  });
}