/*
 * 正文图片下载（MAIN world）。
 *
 * 只做一件事：把勾选的图片 URL 抓成 Blob。不做重试、不做兜底、不改写内容 ——
 * 单张失败只记录失败原因，由调用方决定「保留远程链接 + 如实上报」，而不是悄悄补救。
 *
 * 用默认的 fetch（等价 credentials: 'same-origin'）：同源图片会带上站点 Cookie；
 * 跨域图片只有对方给出 CORS 头才能读，读不到就算失败（不猜测、不伪造）。
 */

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
        const { blob, contentType } = await fetchImage(url);
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
