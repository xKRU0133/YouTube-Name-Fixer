const CACHE_KEY = 'yt_name_fix_cache_v2'; // 変更時要注意(main.jsと同じにする)

const META_NAME_PATTERN = /<meta itemprop="name" content="([^"]+)"/; // 要改善(すぐ壊れる可能性大)
const OG_TITLE_PATTERN = /<meta property="og:title" content="([^"]+)"/;

let isCacheLoaded = false;

function loadCache(callback) {
  chrome.storage.local.get(CACHE_KEY, result => {
    callback(result[CACHE_KEY] || {});
  });
}

function calculateBytes(obj) {
  return new Blob([JSON.stringify(obj)]).size;
}

function updateDisplay() {
  loadCache(cache => {
    const entries = Object.keys(cache);
    document.getElementById('count').textContent = entries.length;

    const sizeInMB = calculateBytes(cache) / 1024 / 1024;
    document.getElementById('size').textContent = sizeInMB.toFixed(2) + ' MB';

  });
}

function touchCacheEntry(handleName, data) {
  cache.delete(handleName);
  cache.set(handleName, data);
}

function saveName(handleName, name) {
  if (!isCacheLoaded) return;

  const entry = {
    name: name,
    timestamp: Date.now(),
    failures: 0
  };

  touchCacheEntry(handleName, entry);
}

function HandleInput(rawInput) {
  if (!rawInput) return null;

  let value = rawInput
    .trim()
    .replace(/＠/g, "@")
    .replace(/\s+/g, "")
    .replace(/@+/g, "");

  if (!value) return null;

  return `@${value.toLowerCase()}`;
}

document.getElementById('show').onclick = () => {
  loadCache(cache => {
    const listElement = document.getElementById('list');

    if (listElement.classList.contains('hidden')) {
      const items = Object.entries(cache).map(([handle, data]) => {
        return `<div>${handle} → ${data.name}</div>`;
      });

      listElement.innerHTML = items.join('');
      listElement.classList.remove('hidden');
    } else {
      listElement.classList.add('hidden');
    }
  });
};

document.getElementById('addUser').onclick = () => {
  const inputElement = document.getElementById('input');
  const errorBox = document.getElementById('error');

  if (inputElement.classList.contains('hidden')) {

    inputElement.classList.remove('hidden');
  } else {
    inputElement.classList.add('hidden');
    errorBox.classList.add('hidden');
  }
}
// そのうち書き直すかも ===== ^..^
document.getElementById('add').onclick = async function () {
  const rawInput = document.getElementById('handleName').value;
  const errorBox = document.getElementById('error');

  const handleName = HandleInput(rawInput);

  if (!handleName) {
    errorBox.classList.remove('hidden');
    errorBox.innerText = '@ハンドル名を入力してください。';
    setTimeout(() => {
      errorBox.classList.add('hidden');
    }, 3000);
    return;
  }

  try {
    const response = await fetch(`https://www.youtube.com/${handleName}/about`, {
      credentials: 'omit'
    });

    if (!response.ok) throw new Error('Fetch failed');

    const html = await response.text();
    const metaMatch = META_NAME_PATTERN.exec(html);
    const ogMatch = OG_TITLE_PATTERN.exec(html);
    const match = metaMatch || ogMatch;

    if (match && match[1]) {
      const name = match[1].trim();

      loadCache(cache => {
        cache[handleName] = {
          name: name,
          timestamp: Date.now(),
          failures: 0
        };
        chrome.storage.local.set({ [CACHE_KEY]: cache }, () => {
          updateDisplay();
          errorBox.classList.remove('hidden');
          errorBox.style.color = 'green';
          errorBox.innerText = `追加しました: ${name}`;
          setTimeout(() => {
            errorBox.classList.add('hidden');
            errorBox.style.color = '';
          }, 3000);
        });
      });
    } else {
      throw new Error('名前が見つかりませんでした');
    }
  } catch (error) {
    errorBox.classList.remove('hidden');
    errorBox.innerText = `エラー: ${error.message}`;
    setTimeout(() => {
      errorBox.classList.add('hidden');
    }, 3000);
  }
};
// ===== ^..^

document.getElementById('clear').onclick = () => {
  if (confirm('キャッシュを削除しますか？')) {
    chrome.storage.local.set({
      [CACHE_KEY]: {}
    }, () => {
      updateDisplay();
    });
  }
};

updateDisplay();
