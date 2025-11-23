const ENABLE_LOG = false;
const log = (...a) => ENABLE_LOG && console.log("[YT-name-fix]", ...a);

const cache = new Map();
const inflight = new Map();

async function fetchChannelName(handle) {
  if (!handle.startsWith("@")) return null;
  const key = handle.toLowerCase();
  if (cache.has(key)) return cache.get(key);
  if (inflight.has(key)) return inflight.get(key);

  const url = `https://www.youtube.com/${handle}`;
  const promise = (async () => {
    try {
      const res = await fetch(url);
      const text = await res.text();
      const match =
        text.match(/<meta itemprop="name" content="([^"]+)"/) ||
        text.match(/<meta property="og:title" content="([^"]+)"/);
      if (match && match[1]) {
        const name = match[1].trim();
        cache.set(key, name);
        log("Fetched:", name, "←", handle);
        return name;
      }
    } catch (e) {
      log("Fetch failed:", handle, e);
    } finally {
      inflight.delete(key);
    }
    return null;
  })();

  inflight.set(key, promise);
  return promise;
}

async function replaceAuthorName(authorEl) {
  if (!authorEl || authorEl.dataset.ytNameFixed) return;
  const handle = authorEl.textContent.trim();
  if (!handle.startsWith("@")) return;

  const displayName = await fetchChannelName(handle);
  if (displayName && displayName !== handle) {
    authorEl.textContent = displayName;
    authorEl.dataset.ytNameFixed = "1";
    authorEl.title = handle;
    log("Replaced:", handle, "→", displayName);
  }
}

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), delay);
  };
}

const scanChatDebounced = debounce(() => {
  document.querySelectorAll("#author-name:not([data-yt-name-fixed])")
    .forEach(replaceAuthorName);
}, 200);

function startObserver() {
  const chat = document.querySelector("yt-live-chat-item-list-renderer");
  if (!chat) {
    log("Chat not ready, retrying...");
    return setTimeout(startObserver, 1000);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.id === "author-name") {
          replaceAuthorName(node);
        } else if (node.querySelectorAll) {
          node.querySelectorAll("#author-name:not([data-yt-name-fixed])")
            .forEach(replaceAuthorName);
        }
      }
    }
  });
  observer.observe(chat, { childList: true, subtree: true });
  log("Observer started");
  setInterval(scanChatDebounced, 5000);
}

function installReinitHook() {
  window.addEventListener("yt-page-data-updated", () => {
    log("Page updated → reinit");
    setTimeout(init, 1500);
  });
}

function init() {
  log("Init YouTube Live Name Fix");
  cache.clear();
  startObserver();
  scanChatDebounced();
}

if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(() => {
    installReinitHook();
    init();
  }, 500);
} else {
  window.addEventListener("DOMContentLoaded", () => {
    installReinitHook();
    init();
  });
}

