const CACHE_KEY = 'yt_name_fix_cache_v2';
const MAX_CACHE_SIZE = 15000;
const CACHE_EXPIRY_DAYS = 2;
const CACHE_EXPIRY_MS = CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

const VISIBLE_BATCH_SIZE = 25;
const VISIBLE_TICK = 5;
const BG_TICK = 90;

const MAX_CONCURRENT_FETCHES = 6;
const RESCAN_INTERVAL = 400;
const MAX_FETCH_FAILURES = 3;
const FAILURE_TIME = 3;
const FAILURE_COOLDOWN = FAILURE_TIME * 60 * 60 * 1000;
const SAVE_DEBOUNCE = 1500;

const SELECTORS = {
  liveChat: '#author-name',
  comments: '#author-text',
  channelName: 'ytd-channel-name yt-formatted-string#text',
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
  const removeCount = cache.size - MAX_CACHE_SIZE;
  const it = cache.keys();
  for (let i = 0; i < removeCount; i++) {
    cache.delete(it.next().value);
  }
}

function removeExpiredEntries() {
  const cutoff = Date.now() - CACHE_EXPIRY_MS;
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
    chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(cache) });
  }, SAVE_DEBOUNCE);
}

function getCachedName(handle, mustLoad = false) {
  if (mustLoad && !isCacheLoaded) {
    return loadCache().then(() => getCachedName(handle, false));
  }
  if (!isCacheLoaded) return null;
  const entry = cache.get(handle);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) return null;
  return entry.name;
}

function saveName(handle, name, mustLoad = false) {
  if (mustLoad && !isCacheLoaded) {
    return loadCache().then(() => saveName(handle, name, false));
  }
  if (!isCacheLoaded) return;
  const entry = { name, timestamp: Date.now(), failures: 0 };
  touchCacheEntry(handle, entry);
  evictOldEntries();
  debounceSave();
}

function recordFailure(handle) {
  const entry = cache.get(handle) || { name: null, timestamp: 0, failures: 0 };
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

function extractJson(html, name) {
  const re = new RegExp(`${name}\\s*=\\s*(\\{[\\s\\S]*?\\});`);
  const match = html.match(re);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractChannelNameFromInitialData(html) {
  const data = extractJson(html, 'ytInitialData');
  if (!data) return null;
  try {
    return data.metadata.channelMetadataRenderer.title.trim();
  } catch {
    return null;
  }
}

function extractChannelNameFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const metaName = doc.querySelector('meta[itemprop="name"]')?.content;
  if (metaName) return metaName.trim();
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.content;
  if (ogTitle) return ogTitle.replace(/\s+-\s+YouTube$/, '').trim();
  return null;
}

function extractChannelName(html) {
  return (
    extractChannelNameFromInitialData(html) ||
    extractChannelNameFromHtml(html)
  );
}

async function fetchChannelName(handle) {
  try {
    const cached = getCachedName(handle);
    if (cached) return;
    if (!shouldRetryFetch(handle)) return;
    const response = await fetch(`https://www.youtube.com/${handle}/about`, {
      credentials: 'omit'
    });
    if (!response.ok) throw new Error();
    const html = await response.text();
    const name = extractChannelName(html);
    if (name) {
      saveName(handle, name);
      updateElementsForHandle(handle);
    } else {
      recordFailure(handle);
    }
  } catch {
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

function processElement(element, isPriority = false) {
  if (!element.isConnected) return;
  if (element.dataset.ytNameFixed) return;
  const text = element.textContent?.trim();
  if (!text?.startsWith('@')) return;
  trackElement(text, element);
  const cachedName = getCachedName(text);
  if (cachedName) {
    if (element.tagName === 'YT-FORMATTED-STRING') {
      const linkElement = element.querySelector('a.yt-simple-endpoint');
      if (linkElement) {
        linkElement.textContent = cachedName;
      } else {
        const textNode = Array.from(element.childNodes).find(n => n.nodeType === Node.TEXT_NODE);
        if (textNode) {
          textNode.textContent = cachedName;
        } else {
          element.innerHTML = '';
          element.appendChild(document.createTextNode(cachedName));
        }
      }
      element.setAttribute('title', text);
    } else {
      element.textContent = cachedName;
      element.title = text;
    }
    element.dataset.ytNameFixed = '1';
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

setInterval(() => processQueue(priorityQueue), VISIBLE_TICK);
setInterval(() => processQueue(backgroundQueue), BG_TICK);

function scanElements(visibleOnly = false) {
  if (!isCacheLoaded) return;
  const liveChatElements = Array.from(document.querySelectorAll(SELECTORS.liveChat));
  const commentElements = Array.from(document.querySelectorAll(SELECTORS.comments))
    .filter(el => el.textContent?.trim().startsWith('@'));
  const channelNameElements = Array.from(document.querySelectorAll(SELECTORS.channelName))
    .filter(el => el.textContent?.trim().startsWith('@'));
  let allElements = [...liveChatElements, ...commentElements, ...channelNameElements];
  if (visibleOnly) {
    allElements = allElements.filter(isElementVisible).slice(-VISIBLE_BATCH_SIZE);
  }
  for (const el of allElements) {
    if (!el.dataset.ytNameFixed) {
      processElement(el, visibleOnly);
    }
  }
}

function setupObserver(containerSelector, targetSelector, retryDelay = 800) {
  const container = document.querySelector(containerSelector);
  if (!container) {
    setTimeout(() => setupObserver(containerSelector, targetSelector, retryDelay), retryDelay);
    return;
  }
  const observer = new MutationObserver(mutations => {
    if (!isCacheLoaded) return;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const targetElement = node.querySelector?.(targetSelector);
        if (targetElement) {
          const isPriority = isElementVisible(targetElement);
          processElement(targetElement, isPriority);
        }
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
}

async function initialize() {
  await loadCache();
  setupObserver(SELECTORS.liveChatContainer, SELECTORS.liveChat);
  setupObserver(SELECTORS.commentsContainer, SELECTORS.comments);
  setupObserver(SELECTORS.commentsContainer, SELECTORS.channelName);
  scanElements(true);
  scanElements(false);
  setInterval(() => scanElements(true), 200);
  setInterval(() => scanElements(false), RESCAN_INTERVAL);
  setInterval(cleanupDisconnectedElements, 60000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initialize);
} else {
  initialize();
}
