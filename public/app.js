const searchBtn = document.getElementById('searchBtn');
const keywordInput = document.getElementById('keyword');
const resultDiv = document.getElementById('result');
const loadingDiv = document.getElementById('loading');

searchBtn.addEventListener('click', search);

async function search() {

  const keyword = keywordInput.value.trim();

  if (!keyword) {
    alert('검색어 입력');
    return;
  }

  resultDiv.innerHTML = '';
  loadingDiv.classList.remove('hidden');

  try {

    const response = await fetch(
      `/search?keyword=${encodeURIComponent(keyword)}`
    );

    const json = await response.json();

    loadingDiv.classList.add('hidden');

    if (!json.success) {
      alert('실패');
      return;
    }

    render(json.data);

  } catch (error) {

    loadingDiv.classList.add('hidden');

    alert('에러 발생');

    console.error(error);

  }

}

function render(data) {

  resultDiv.innerHTML = '';

  data.result.forEach(place => {

    const card = document.createElement('div');

    card.className = 'card';

    let html = `
      <h2>${place.name}</h2>
      <p>리뷰 수 : ${place.reviewCount}</p>
    `;

    place.reviews.forEach(review => {

      html += `
        <div class="review">
          ${review}
        </div>
      `;

    });

    card.innerHTML = html;

    resultDiv.appendChild(card);

  });

}