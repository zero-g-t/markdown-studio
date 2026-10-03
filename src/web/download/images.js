/*
 * 正文图片下载（MAIN world）。
 *
 * 只做一件事：把勾选的图片 URL 抓成 Blob。不做重试、不做兜底、不改写内容 ——
 * 单张失败只记录失败原因，由调用方决定「保留远程链接 + 如实上报」，而不是悄悄补救。
 *
 * 传输路径（详见下方 fetchImageByTransport 的注释）：
 *   · 同源：页面上下文 fetch；
 *   · 跨域：先页面 fetch（带页面 Origin/Referer，防盗链站点认这个）；读不到响应体时才改由
 *     内容脚本 → Service Worker 代抓（扩展权限不受页面同源策略限制），这样没有 CORS 头的
 *     跨域图（GitHub 的 camo 反代、各类图床）也能本地化。
 *     代抓的字节走 base64 跨 world 传输（runtime 消息只接受可序列化值），在本模块内解回 Blob。
 */
import { FEISHU_EVENT, POST_MESSAGE_FLAG } from '../../feishu/protocol.js';

// 并发上限：目标站点大多按单站限速，5 个并发基本能打满带宽又不会造成突发压力
export const IMAGE_CONCURRENCY = 5;

const CONTENT_TYPE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico'
};

function hasExtension(name) {
  return /\.[a-z0-9]{1,8}$/i.test(name);
}

/**
 * 给没有扩展名的文件名补上由响应 Content-Type 推导的扩展名。
 * URL 自带扩展名、或 Content-Type 认不出来时，原样返回（不猜）。
 */
export function ensureExtension(name, contentType) {
  if (hasExtension(name)) {
    return name;
  }

  const type = String(contentType || '').split(';')[0].trim().toLowerCase();

  return CONTENT_TYPE_EXTENSIONS[type] ? `${name}${CONTENT_TYPE_EXTENSIONS[type]}` : name;
}

async function fetchImage(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();

  if (blob.size === 0) {
    throw new Error('响应内容为空');
  }

  return { blob, contentType: response.headers.get('content-type') || blob.type };
}

/*
 * 等待扩展代抓结果的上限：Service Worker 被唤醒、抓取、回传都要时间，但绝不能无限等
 * （内容脚本缺席或消息没回来时，进度环会永远停在原地）。超时即如实报错，不重发。
 */
const FETCH_TIMEOUT_MS = 30000;

// requestId → pending：一次请求一个序号，只在收到同 requestId 的结果时结算
let fetchRequestSeq = 0;
const pendingFetches = new Map();

window.addEventListener('message', (event) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data;

  if (!data || data[POST_MESSAGE_FLAG] !== true || data.event !== FEISHU_EVENT.FETCH_IMAGE_RESULT) {
    return;
  }

  const pending = pendingFetches.get(data.requestId);

  if (!pending) {
    return;
  }

  pendingFetches.delete(data.requestId);
  clearTimeout(pending.timer);
  pending.resolve(data);
});

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * 请求扩展（内容脚本 → Service Worker）代抓一张跨域图片。
 * 成功返回原始结果载荷，失败原因由调用方从 result.error 取。
 */
function requestImageFromExtension(url) {
  return new Promise((resolve, reject) => {
    fetchRequestSeq += 1;
    const requestId = `image-${fetchRequestSeq}`;
    const timer = setTimeout(() => {
      pendingFetches.delete(requestId);
      reject(new Error('扩展抓取超时'));
    }, FETCH_TIMEOUT_MS);

    pendingFetches.set(requestId, { resolve, timer });
    window.postMessage(
      { [POST_MESSAGE_FLAG]: true, event: FEISHU_EVENT.FETCH_IMAGE, requestId, url },
      '*'
    );
  });
}

async function fetchCrossOriginImage(url) {
  const result = await requestImageFromExtension(url);

  if (!result.ok) {
    throw new Error(result.error || '扩展抓取失败');
  }

  const contentType = result.contentType || '';
  const blob = new Blob([base64ToBytes(result.base64)], {
    type: contentType || 'application/octet-stream'
  });

  if (blob.size === 0) {
    throw new Error('响应内容为空');
  }

  return { blob, contentType: contentType || blob.type };
}

/*
 * 同源判定用页面自身的 origin：同源图一定读得到，就走页面 fetch（保留凭据，也保留页面 Referer）。
 * URL 解析异常按跨域处理（页面侧没有可靠凭据可带）。
 */
function isSameOrigin(url) {
  try {
    return new URL(url).origin === location.origin;
  } catch {
    return false;
  }
}

/*
 * 「响应连读都读不到」的判定：fetch 被同源策略拦下、以及网络层失败，在 JS 层都表现为
 * TypeError（拿不到 status、拿不到 body）。服务器给出的错误码不走这里 ——
 * fetchImage 对非 2xx 抛的是普通 Error(`HTTP 403`)，说明响应可读，必须如实上报。
 */
function isUnreadable(error) {
  return error instanceof TypeError;
}

/*
 * 取字节的两条通道，分工依据是「页面上下文能不能读到响应体」——这件事只有发出去才知道：
 *
 *   · 同源：页面 fetch 一定读得到，直接用；
 *   · 跨域：先按页面上下文 fetch（自带页面的 Origin/Referer/凭据，防盗链站点认这个）。
 *     对方给了 CORS 头就读得到，用它的结果；读不到（TypeError）才改由扩展权限代抓 ——
 *     扩展抓的请求没有页面 Referer（扩展脚本地址是 chrome-extension:// 方案，按规范会被丢弃），
 *     对 Sina 图床这类「无 Referer 就 403」的站点会被拒，所以不能无条件取代页面 fetch。
 *
 * 这是经用户批准的、有实测依据的两段式分工（2026-10-03：weibo 的 wx*.sinaimg.cn 图在
 * 无 Referer 时被 403，而页面 fetch 正常 200 + type=cors），不是「失败后重试」：
 * 每张图最多换一次通道，且换通道的唯一触发条件是「规范上不可读」，服务器返回的错误码一律如实上报。
 */
async function fetchImageByTransport(url) {
  if (isSameOrigin(url)) {
    return fetchImage(url);
  }

  try {
    return await fetchImage(url);
  } catch (error) {
    if (!isUnreadable(error)) {
      throw error;
    }

    return fetchCrossOriginImage(url);
  }
}

/**
 * 并发下载一批图片。
 *
 * @param {string[]} urls
 * @param {(state: { done: number, total: number, url: string, failureCount: number }) => void} [onProgress]
 * @returns {Promise<{ successes: Array<{url: string, blob: Blob, contentType: string}>,
 *                     failures: Array<{url: string, reason: string}> }>}
 */
export async function downloadImages(urls, onProgress) {
  const queue = [...urls];
  const total = queue.length;
  const successes = [];
  const failures = [];
  let done = 0;

  if (total === 0) {
    return { successes, failures };
  }

  const worker = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) {
      try {
        const { blob, contentType } = await fetchImageByTransport(url);
        successes.push({ url, blob, contentType });
      } catch (error) {
        failures.push({ url, reason: error?.message || String(error) });
      }

      done += 1;
      onProgress?.({ done, total, url, failureCount: failures.length });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(IMAGE_CONCURRENCY, total) }, () => worker())
  );

  return { successes, failures };
}
