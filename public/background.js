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

/*
 * 「网页/飞书文档 → Markdown」的落盘通道（与 src/feishu/protocol.js 保持一致）。
 *
 * 为什么必须由 Service Worker 做：转换器跑在页面 MAIN world（没有 chrome.*），而
 * 「在浏览器默认下载目录下建 `<标题>/` 子文件夹」只有 chrome.downloads 做得到 ——
 * `<a download>` 的路径分隔符会被浏览器抹掉，做不出子目录。downloads 的 filename
 * 支持相对子目录，是唯一的通道。
 *
 * 为什么二进制要走离屏文档：data URL 会撞上 URL 长度上限（Chrome 约 2MB），图片稍大就失败；
 * 而 MV3 的 Service Worker 里没有 URL.createObjectURL，只能在离屏文档里把字节转成 blob URL。
 */
const SAVE_CLIP_FILE_MESSAGE = 'MD_STUDIO_SAVE_CLIP_FILE';
const OPEN_CLIP_MESSAGE = 'MD_STUDIO_OPEN_CLIP';
const OFFSCREEN_TARGET = 'md-studio-offscreen';
const OFFSCREEN_URL = 'offscreen.html';

// 等单个文件落盘完成的兜底上限：正常是毫秒级，超时只可能是下载卡住，如实报错，不重试
const DOWNLOAD_TIMEOUT_MS = 2 * 60 * 1000;

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

/* 离屏文档：复用同一个，用完即关（关闭时 blob URL 一并回收） */
let offscreenCreation = null;

async function ensureOffscreenDocument() {
  if (!chrome.offscreen) {
    throw new Error('当前浏览器不支持离屏文档（chrome.offscreen），无法写入二进制文件');
  }

  if (await chrome.offscreen.hasDocument()) {
    return;
  }

  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['BLOBS'],
        justification: '把图片/文档内容转成 blob URL，供 chrome.downloads 写入本地文件夹'
      })
      .finally(() => {
        offscreenCreation = null;
      });
  }

  await offscreenCreation;
}

async function closeOffscreenDocument() {
  if (!chrome.offscreen || !(await chrome.offscreen.hasDocument())) {
    return;
  }

  await chrome.offscreen.closeDocument();
}

async function createBlobUrl(base64, mime) {
  await ensureOffscreenDocument();

  const response = await chrome.runtime.sendMessage({
    target: OFFSCREEN_TARGET,
    type: 'CREATE_BLOB_URL',
    base64,
    mime
  });

  if (!response?.ok || typeof response.url !== 'string' || response.url === '') {
    throw new Error(response?.error || '创建 blob URL 失败');
  }

  return response.url;
}

async function releaseBlobUrl(url) {
  try {
    await chrome.runtime.sendMessage({ target: OFFSCREEN_TARGET, type: 'REVOKE_BLOB_URL', url });
  } catch {
    // 离屏文档已经关掉时消息无人接收：blob URL 随文档一起消失，不需要额外处理
  }
}

/*
 * 把 folder + path 拼成 chrome.downloads 认的相对路径。
 *
 * 只接受「干净的相对路径」：绝对路径、盘符、`..`、Windows 非法字符一律拒绝并报错。
 * 这里不做静默改名 —— 改了名，Markdown 里引用的 `assets/` 路径就会和磁盘上的文件对不上。
 */
function buildRelativeFilename(folder, path) {
  const segments = [folder, path]
    .flatMap((part) => String(part ?? '').split(/[/\\]/))
    .filter((segment) => segment !== '');

  if (segments.length === 0) {
    throw new Error('文件名为空');
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..') {
      throw new Error(`非法路径片段：${segment}`);
    }

    if (/[\u0000-\u001F]/.test(segment)) {
      throw new Error(`文件名含控制字符：${segment}`);
    }

    if (/[:*?"<>|]/.test(segment)) {
      throw new Error(`文件名含非法字符：${segment}`);
    }
  }

  return segments.join('/');
}

/* 绝对路径 → file:// URL：逐段编码，但保留 Windows 盘符里的冒号（`C:` 不能变成 `C%3A`） */
function toFileUrl(absolutePath) {
  const normalized = String(absolutePath).replace(/\\/g, '/');
  const rooted = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = rooted
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/%3A/gi, ':'))
    .join('/');

  return `file://${encoded}`;
}

/* 等待中的落盘任务：downloadId → 结算回调。onChanged 事件会唤醒/续用本 Service Worker */
const pendingDownloads = new Map();

function settleDownload(downloadId, result) {
  const pending = pendingDownloads.get(downloadId);

  if (!pending) {
    return;
  }

  pendingDownloads.delete(downloadId);
  clearTimeout(pending.timer);
  pending.resolve(result);
}

chrome.downloads.onChanged.addListener((delta) => {
  if (delta.state?.current === 'complete') {
    settleDownload(delta.id, { ok: true });
    return;
  }

  if (delta.state?.current === 'interrupted') {
    settleDownload(delta.id, { ok: false, error: delta.error?.current || '下载被中断' });
  }
});

/*
 * 等一个下载任务真正落盘完成。
 *
 * 先注册等待、再读一次当前状态：download() 与这里之间任务可能就已经结束了
 * （onChanged 早于注册，先注册才不会漏掉事件）。这一次 search 是「读一次真实状态」，
 * 不是重试；settleDownload 幂等，事件与这次读取谁先到都只结算一次。
 */
async function waitForDownload(downloadId) {
  const settled = new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingDownloads.delete(downloadId);
      resolve({ ok: false, error: '写入本地文件超时' });
    }, DOWNLOAD_TIMEOUT_MS);

    pendingDownloads.set(downloadId, { resolve, timer });
  });

  const [current] = await chrome.downloads.search({ id: downloadId });

  if (!current) {
    settleDownload(downloadId, { ok: false, error: '下载任务不存在' });
  } else if (current.state === 'complete') {
    settleDownload(downloadId, { ok: true });
  } else if (current.state === 'interrupted') {
    settleDownload(downloadId, { ok: false, error: current.error || '下载被中断' });
  }

  const result = await settled;

  if (!result.ok) {
    return result;
  }

  const [item] = await chrome.downloads.search({ id: downloadId });

  if (!item?.filename) {
    return { ok: false, error: '下载任务没有可用的文件路径' };
  }

  return { ok: true, filename: item.filename };
}

/*
 * 写一个文件到「默认下载目录/<folder>/<path>」。
 *
 * conflictAction: 'overwrite' 是刻意的：同一标题重新下载时，md 里引用的 `assets/` 路径
 * 必须与磁盘上的文件名继续对得上，uniquify 会让二者错位。
 */
async function handleSaveClipFile(message, sendResponse) {
  let blobUrl = null;

  try {
    const filename = buildRelativeFilename(message.folder, message.path);

    blobUrl = await createBlobUrl(message.base64, message.mime);

    const downloadId = await chrome.downloads.download({
      url: blobUrl,
      filename,
      conflictAction: 'overwrite',
      saveAs: false
    });

    const result = await waitForDownload(downloadId);

    if (!result.ok) {
      sendResponse({ ok: false, error: result.error });
      return;
    }

    sendResponse({ ok: true, filename: result.filename, downloadId });
  } catch (error) {
    sendResponse({ ok: false, error: error?.message || String(error) });
  } finally {
    if (blobUrl) {
      await releaseBlobUrl(blobUrl);
    }
  }
}

/* 把刚写入的 Markdown 在新标签页打开：file:// 页面会被 open-md-file.js 接管并导入编辑器 */
async function handleOpenClip(message, sendResponse) {
  try {
    if (typeof message.downloadId !== 'number') {
      sendResponse({ ok: false, error: '缺少下载任务标识' });
      return;
    }

    const [item] = await chrome.downloads.search({ id: message.downloadId });

    if (!item) {
      sendResponse({ ok: false, error: '找不到刚写入的文件' });
      return;
    }

    if (item.state !== 'complete') {
      sendResponse({ ok: false, error: `文件尚未写入完成（${item.state}）` });
      return;
    }

    await chrome.tabs.create({ url: toFileUrl(item.filename) });
    sendResponse({ ok: true, filename: item.filename });
  } catch (error) {
    sendResponse({ ok: false, error: error?.message || String(error) });
  } finally {
    // 本轮落盘结束：关掉离屏文档，把用过的 blob URL 一并回收
    await closeOffscreenDocument().catch(() => {});
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

  if (message?.type === SAVE_CLIP_FILE_MESSAGE) {
    handleSaveClipFile(message, sendResponse);
    return true;
  }

  if (message?.type === OPEN_CLIP_MESSAGE) {
    handleOpenClip(message, sendResponse);
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
