const CACHE_KEY = 'yt_name_fix_cache_v2';
const MAX_CACHE_SIZE = 15000;
const CACHE_EXPIRY_DAYS = 2;
const CACHE_EXPIRY_MS = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

const VISIBLE_BATCH_SIZE = 25;
const VISIBLE_TICKL = 0;
const BG_TICK = 90;

const MAX_CONCURRENT_FETCHES = 6;
const RESCAN_INTERVAL = 400;
const MAX_FETCH_FAILURES = 3;
const FAILURE_COOLDOWN = 6 * 60 * 60 * 1000;
const SAVE_DEBOUNCE = 2000;

const META_NAME_PATTERN = /<meta itemprop="name" content="([^"]+)"/;
const OG_TITLE_PATTERN = /<meta property="og:title" content="([^"]+)"/;

const SELECTORS = {
  liveChat: '#author-name',
  comments: '#author-text',
  liveChatContainer: 'yt-live-chat-item-list-renderer',
  commentsContainer: 'ytd-comments#comments'
};

let cache = new Map();
let saveTimeout = null;
let isCacheLoaded = false;
const handleElementMap = new Map();
const priorityQueue = [];
const backgroundQueue = [];
const queuedElements = new WeakSet();
const priorityFetchQueue = [];
const normalFetchQueue = [];
const currentlyFetching = new Set();

async function loadCache() {
  if (isCacheLoaded) return cache;
  
  return new Promise(resolve => {
    chrome.storage.local.get(CACHE_KEY, result => {
      const stored = result[CACHE_KEY] || {};
      cache = new Map(Object.entries(stored));
      isCacheLoaded = true;
      resolve(cache);
    });
  });
}

function touchCacheEntry(handle, data) {
  cache.delete(handle);
  cache.set(handle, data);
}

function evictOldEntries() {
  if (cache.size <= MAX_CACHE_SIZE) return;
  
  const itemsToRemove = cache.size - MAX_CACHE_SIZE;
  const iterator = cache.keys();
  
  for (let i = 0; i < itemsToRemove; i++) {
    cache.delete(iterator.next().value);
  }
}

function removeExpiredEntries() {
  const now = Date.now();
  const cutoff = now - CACHE_EXPIRY_MS;
  
  for (const [handle, entry] of cache) {
    if (!entry.failures && entry.timestamp < cutoff) {
      cache.delete(handle);
    }
  }
}

function debounceSave() {
  if (saveTimeout) return;
  
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
    removeExpiredEntries();
    chrome.storage.local.set({
      [CACHE_KEY]: Object.fromEntries(cache)
    });
  }, SAVE_DEBOUNCE);
}

function getCachedName(handle) {
  if (!isCacheLoaded) return null;
  
  const entry = cache.get(handle);
  if (!entry) return null;
  
  if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
    return null;
  }
  
  return entry.name;
}

async function getCachedNameAsync(handle) {
  await loadCache();
  return getCachedName(handle);
}

function saveName(handle, name) {
  if (!isCacheLoaded) return;
  
  const entry = {
    name: name,
    timestamp: Date.now(),
    failures: 0
  };
  
  touchCacheEntry(handle, entry);
  evictOldEntries();
  debounceSave();
}

async function saveNameAsync(handle, name) {
  await loadCache();
  saveName(handle, name);
}

function recordFailure(handle) {
  const entry = cache.get(handle) || {
    name: null,
    timestamp: 0,
    failures: 0
  };
  
  entry.failures++;
  entry.timestamp = Date.now();
  
  touchCacheEntry(handle, entry);
  evictOldEntries();
  debounceSave();
}

function shouldRetryFetch(handle) {
  const entry = cache.get(handle);
  
  if (!entry || !entry.failures) return true;
  if (entry.failures < MAX_FETCH_FAILURES) return true;
  
  return Date.now() - entry.timestamp > FAILURE_COOLDOWN;
}

function queueFetch(handle, priority = false) {
  if (currentlyFetching.has(handle)) return;
  if (priorityFetchQueue.includes(handle)) return;
  if (normalFetchQueue.includes(handle)) return;
  
  if (priority) {
    priorityFetchQueue.push(handle);
  } else {
    normalFetchQueue.push(handle);
  }
  
  processFetchQueue();
}

async function processFetchQueue() {
  while (currentlyFetching.size < MAX_CONCURRENT_FETCHES) {
    const handle = priorityFetchQueue.shift() || normalFetchQueue.shift();
    if (!handle) break;
    
    currentlyFetching.add(handle);
    
    fetchChannelName(handle).finally(() => {
      currentlyFetching.delete(handle);
      processFetchQueue();
    });
  }
}

async function fetchChannelName(handle) {
  try {
    const cached = getCachedName(handle);
    if (cached) return;
    
    if (!shouldRetryFetch(handle)) return;

    const response = await fetch(`https://www.youtube.com/${handle}/about`, { //　/aboutのが軽い？
      credentials: 'omit'
    });
    
    if (!response.ok) throw new Error('Fetch failed');

    const html = await response.text();
    
    const metaMatch = META_NAME_PATTERN.exec(html);
    const ogMatch = OG_TITLE_PATTERN.exec(html);
    const match = metaMatch || ogMatch;

    if (match && match[1]) {
      const name = match[1].trim();
      saveName(handle, name);
      updateElementsForHandle(handle);
    } else {
      recordFailure(handle);
    }
  } catch (err) {
    recordFailure(handle);
  }
}

function trackElement(handle, element) {
  if (!handleElementMap.has(handle)) {
    handleElementMap.set(handle, new Set());
  }
  handleElementMap.get(handle).add(element);
}

function updateElementsForHandle(handle) {
  const elements = handleElementMap.get(handle);
  if (!elements) return;

  for (const el of elements) {
    if (!el.isConnected) {
      elements.delete(el);
      continue;
    }
    
    if (!el.dataset.ytNameFixed) {
      processElement(el, true);
    }
  }

  if (elements.size === 0) {
    handleElementMap.delete(handle);
  }
}

function cleanupDisconnectedElements() {
  for (const [handle, elements] of handleElementMap) {
    for (const el of elements) {
      if (!el.isConnected) {
        elements.delete(el);
      }
    }
    
    if (elements.size === 0) {
      handleElementMap.delete(handle);
    }
  }
}

function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < window.innerHeight &&
    rect.right > 0 &&
    rect.left < window.innerWidth
  );
}

function addToQueue(element, priority = false) {
  if (!element || element.dataset.ytNameFixed) return;
  if (queuedElements.has(element)) return;
  
  queuedElements.add(element);
  
  if (priority) {
    priorityQueue.push(element);
  } else {
    backgroundQueue.push(element);
  }
}

function isCommentElement(element) {
  return element.matches && element.matches(SELECTORS.comments);
}

function processElement(element, isPriority = false) {
  if (!element.isConnected) return;
  if (element.dataset.ytNameFixed) return;

  const text = element.textContent?.trim();
  if (!text?.startsWith('@')) return;

  trackElement(text, element);

  const cachedName = getCachedName(text);
  
  if (cachedName) {
    element.textContent = cachedName;
    element.dataset.ytNameFixed = '1';
    element.title = text;
  } else {
    const priority = isPriority || isElementVisible(element);
    queueFetch(text, priority);
  }
}

function processQueue(queue) {
  const elements = queue.splice(0, queue.length);
  
  for (const el of elements) {
    queuedElements.delete(el);
    
    if (isCacheLoaded) {
      processElement(el, false);
    } else {
      addToQueue(el, false);
    }
  }
}

setInterval(() => processQueue(priorityQueue), VISIBLE_TICKL);
setInterval(() => processQueue(backgroundQueue), BG_TICK);

function scanVisibleElements() {
  if (!isCacheLoaded) return;

  const liveChatElements = Array.from(document.querySelectorAll(SELECTORS.liveChat));
  const commentElements = Array.from(document.querySelectorAll(SELECTORS.comments))
    .filter(el => el.textContent?.trim().startsWith('@'));
  
  const allElements = [...liveChatElements, ...commentElements];
  const visibleElements = allElements.filter(isElementVisible);
  
  const recentVisible = visibleElements.slice(-VISIBLE_BATCH_SIZE);
  
  for (const el of recentVisible) {
    if (!el.dataset.ytNameFixed) {
      processElement(el, true);
    }
  }
}

function scanAllElements() {
  if (!isCacheLoaded) return;

  const liveChatElements = document.querySelectorAll(SELECTORS.liveChat);
  const commentElements = Array.from(document.querySelectorAll(SELECTORS.comments))
    .filter(el => el.textContent?.trim().startsWith('@'));
  
  const allElements = [...liveChatElements, ...commentElements];
  
  for (const el of allElements) {
    if (!el.dataset.ytNameFixed) {
      processElement(el, false);
    }
  }
}

function setupLiveChatObserver() {
  const chatContainer = document.querySelector(SELECTORS.liveChatContainer);
  
  if (!chatContainer) {
    setTimeout(setupLiveChatObserver, 800);
    return;
  }

  const observer = new MutationObserver(mutations => {
    if (!isCacheLoaded) return;
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        
        const authorName = node.querySelector?.(SELECTORS.liveChat);
        
        if (authorName) {
          const isPriority = isElementVisible(authorName);
          processElement(authorName, isPriority);
        }
      }
    }
  });

  observer.observe(chatContainer, {
    childList: true,
    subtree: true
  });
}

function setupCommentsObserver() {
  const commentsContainer = document.querySelector(SELECTORS.commentsContainer);
  
  if (!commentsContainer) {
    setTimeout(setupCommentsObserver, 1000);
    return;
  }

  const observer = new MutationObserver(mutations => {
    if (!isCacheLoaded) return;
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        
        if (isCommentElement(node)) {
          const text = node.textContent?.trim();
          if (text?.startsWith('@')) {
            const isPriority = isElementVisible(node);
            processElement(node, isPriority);
          }
        }

        const commentElements = node.querySelectorAll?.(SELECTORS.comments);
        if (commentElements) {
          for (const el of commentElements) {
            const text = el.textContent?.trim();
            if (text?.startsWith('@')) {
              const isPriority = isElementVisible(el);
              processElement(el, isPriority);
            }
          }
        }
      }
    }
  });

  observer.observe(commentsContainer, {
    childList: true,
    subtree: true
  });
}

async function initialize() {
  await loadCache();
  
  setupLiveChatObserver();
  setupCommentsObserver();
  scanVisibleElements();
  scanAllElements();
  
  setInterval(scanVisibleElements, 200);
  setInterval(scanAllElements, RESCAN_INTERVAL);
  setInterval(cleanupDisconnectedElements, 60_000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
