chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({
    url: chrome.runtime.getURL('editor.html')
  });
});

function storageSet(area, values) {
  return new Promise((resolve) => {
    area.set(values, resolve);
  });
}

/*
 * 站点适配器注入白名单。
 *
 * 内容脚本只能请求注入白名单内的脚本路径，避免（哪怕是被页面篡改后的）消息请求注入任意文件。
 * 这份列表必须与 src/feishu/site-providers.js 的 PROVIDERS 保持一致：
 * 新增站点适配器时两边都要加。
 */
const SITE_DOWNLOAD_BUNDLES = new Set([
  'bundles/feishu-download.js',
  'bundles/web-download.js'
]);
const SITE_DOWNLOAD_MESSAGE = 'MD_STUDIO_SITE_DOWNLOAD';

/*
 * 跨域图片代抓。
 *
 * 与 src/feishu/protocol.js 的 RUNTIME_MESSAGE_FETCH_IMAGE 保持一致（public/ 下的脚本不经打包，
 * 无法 import 常量，只能各留一份字符串）。
 */
const FETCH_IMAGE_MESSAGE = 'MD_STUDIO_FETCH_IMAGE';

// base64 每轮处理的字节数：分块是为了避开 String.fromCharCode 的参数个数上限
const BASE64_CHUNK_SIZE = 0x8000;

function toBase64(bytes) {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + BASE64_CHUNK_SIZE));
  }

  return btoa(binary);
}

/*
 * 为什么由 Service Worker 抓：转换器跑在页面 MAIN world，那里的 fetch 受页面同源策略约束，
 * 没有 Access-Control-Allow-Origin 的跨域图（如 GitHub 的 camo 反代）读不到响应体；
 * 这里持有 host_permissions，不受 CORS 限制。credentials: 'include' 是为了贴近页面里
 * <img> 的取图行为（需要登录态的图也能拿到）。
 *
 * 只抓一次，不重试：HTTP 非 2xx、空响应、网络异常都原样回传错误文案，由调用方如实上报。
 */
async function handleFetchImage(message, sendResponse) {
  if (typeof message.url !== 'string' || message.url === '') {
    sendResponse({ ok: false, error: '缺少图片地址' });
    return;
  }

  /*
   * 只允许 http/https：请求参数最终源自页面（MAIN world 与页面同源），
   * 不设这道闸，页面就能诱导扩展去读 file:// 下的本地文件并把内容回传。
   */
  let protocol;

  try {
    protocol = new URL(message.url).protocol;
  } catch {
    sendResponse({ ok: false, error: '图片地址不是合法 URL' });
    return;
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    sendResponse({ ok: false, error: `不支持的协议：${protocol}` });
    return;
  }

  try {
    const response = await fetch(message.url, { credentials: 'include' });

    if (!response.ok) {
      sendResponse({ ok: false, error: `HTTP ${response.status}` });
      return;
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength === 0) {
      sendResponse({ ok: false, error: '响应内容为空' });
      return;
    }

    sendResponse({
      ok: true,
      base64: toBase64(new Uint8Array(buffer)),
      contentType: response.headers.get('content-type') || ''
    });
  } catch (error) {
    sendResponse({ ok: false, error: error?.message || String(error) });
  }
}

function handleSiteDownload(message, sender, sendResponse) {
  const tabId = sender.tab?.id;

  if (tabId === undefined) {
    sendResponse({ ok: false, error: '无法定位当前标签页' });
    return;
  }

  if (!SITE_DOWNLOAD_BUNDLES.has(message.bundle)) {
    sendResponse({ ok: false, error: `不支持的站点适配器：${message.bundle}` });
    return;
  }

  // 转换器必须处于页面自身的 JS 上下文：
  //   · 飞书分支要读飞书页面运行时全局对象（window.PageMain）；
  //   · 通用网页分支要读 shadowRoot、并用页面上下文落盘。
  // 因此统一注入到 MAIN world。
  chrome.scripting
    .executeScript({
      files: [message.bundle],
      target: { tabId },
      world: 'MAIN'
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === SITE_DOWNLOAD_MESSAGE) {
    handleSiteDownload(message, sender, sendResponse);
    return true;
  }

  if (message?.type === FETCH_IMAGE_MESSAGE) {
    handleFetchImage(message, sendResponse);
    return true;
  }

  if (message?.type !== 'OPEN_MARKDOWN_FILE') {
    return false;
  }

  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ ok: false });
    return true;
  }

  const id = crypto.randomUUID();
  const key = `markdown-file:${id}`;
  const storage = chrome.storage.session || chrome.storage.local;

  storageSet(storage, {
    [key]: {
      url: message.url,
      name: message.name,
      content: message.content
    }
  }).then(() => {
    chrome.tabs.update(tabId, {
      url: chrome.runtime.getURL(`editor.html?import=${encodeURIComponent(id)}`)
    });
    sendResponse({ ok: true });
  });

  return true;
});
