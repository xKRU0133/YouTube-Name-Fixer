// 定数定義
const CACHE_KEY = 'yt_name_fix_cache_v2';

// キャッシュ情報の読み込み
function loadCache(callback) {
  chrome.storage.local.get(CACHE_KEY, result => {
    callback(result[CACHE_KEY] || {});
  });
}

// オブジェクトのサイズ計算
function calculateBytes(obj) {
  return new Blob([JSON.stringify(obj)]).size;
}

// キャッシュ情報の表示更新
function updateDisplay() {
  loadCache(cache => {
    const entries = Object.keys(cache);
    document.getElementById('count').textContent = entries.length;
    
    const sizeInMB = calculateBytes(cache) / 1024 / 1024;
    document.getElementById('size').textContent = sizeInMB.toFixed(2) + ' MB';
  });
}

// キャッシュ内容の表示・非表示切替
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

// キャッシュのクリア
document.getElementById('clear').onclick = () => {
  if (confirm('キャッシュを削除しますか？')) {
    chrome.storage.local.set({ [CACHE_KEY]: {} }, () => {
      updateDisplay();
    });
  }
};

updateDisplay();
