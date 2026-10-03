/*
 * 网页正文提取 + 正文图片收集/改写（MAIN world）。
 *
 * 提取链路照搬 obsidian-clipper 的「保存为 Markdown」路径：
 *   flattenShadowDom(document) → new Defuddle(document, { url }).parse()
 *
 * 与 obsidian-clipper 的两处差异，都是因为本 bundle 本身就跑在 MAIN world，
 * 而不是跑在内容脚本里：
 *
 *   1. obsidian-clipper 的 flattenShadowDom 需要往页面注入一个 MAIN world 脚本，
 *      得用 chrome.runtime.getURL —— MAIN world 拿不到 chrome.*。
 *      这里把那段「遍历元素、把 shadowRoot.innerHTML 落到属性上」的逻辑直接内联，
 *      语义等价，还省掉了 web_accessible_resources。
 *
 *   2. 图片链接改写放在这份「净化后的 HTML」上做（见 applyLocalSources），
 *      而不是对最终 Markdown 做字符串替换。取源规则与 defuddle 生成 Markdown 时的
 *      规则完全一致（优先 srcset 里宽度最大的候选，回退 src），
 *      这样「清单里列出的图」就必然等于「Markdown 里出现的图」，不会对不上。
 */
import Defuddle, { createMarkdownContent } from 'defuddle/full';
import { safeNormalizeFileName } from '@/lib/utils';

/**
 * 把 shadow DOM 的内容拍平到属性上（逐字搬自 obsidian-clipper 的 flatten-shadow-dom.js，
 * 详见本文件头注释第 1 条）。
 */
export function flattenShadowDom(doc) {
  doc.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot && el.shadowRoot.innerHTML) {
      el.setAttribute('data-defuddle-shadow', el.shadowRoot.innerHTML);
    }
  });
}

/** 同步提取正文（与 obsidian-clipper 的 parseForClip 同款：不带 markdown 选项、事后单独转换） */
export function parsePage(doc) {
  return new Defuddle(doc, { url: doc.URL }).parse();
}

/*
 * 取「最终会进 Markdown 的那个 src」，规则逐字对齐 defuddle dist/markdown.js 的 getBestImageSrc：
 * 优先 srcset 里宽度（Nw）最大的候选，忽略密度描述符（Nx），否则回退 src。
 * 注意不能按逗号切分 srcset —— CDN 的 URL 自身可能含逗号。
 */
const WIDTH_DESCRIPTOR_RE = /^(\d+)w,?$/;
const DENSITY_DESCRIPTOR_RE = /^\d+(?:\.\d+)?x,?$/;

export function getBestImageSrc(img) {
  const srcset = img.getAttribute('srcset');

  if (srcset) {
    let bestUrl = '';
    let bestWidth = 0;
    let urlParts = [];

    for (const token of srcset.trim().split(/\s+/)) {
      const widthMatch = token.match(WIDTH_DESCRIPTOR_RE);

      if (widthMatch) {
        const width = Number.parseInt(widthMatch[1], 10);

        if (urlParts.length > 0 && width > bestWidth) {
          const url = urlParts.join(' ').replace(/^,\s*/, '');

          if (url) {
            bestWidth = width;
            bestUrl = url;
          }
        }

        urlParts = [];
        continue;
      }

      if (DENSITY_DESCRIPTOR_RE.test(token)) {
        urlParts = [];
        continue;
      }

      urlParts.push(token);
    }

    if (bestUrl) {
      return bestUrl;
    }
  }

  return img.getAttribute('src') || '';
}

/** 把净化后的正文 HTML 解析成可读写的文档（改写 img 用） */
export function readContentDocument(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}

/** 输出正文 HTML（与 createMarkdownContent 的入参形态一致：body 内的片段） */
export function serializeContent(contentDoc) {
  return contentDoc.body.innerHTML;
}

function urlBaseName(url, index) {
  try {
    const lastSegment = new URL(url).pathname.split('/').filter(Boolean).pop() || '';

    if (!lastSegment) {
      return `image-${index + 1}`;
    }

    let decoded = lastSegment;

    try {
      decoded = decodeURIComponent(lastSegment);
    } catch {
      // 非法百分号编码：用原始段名，不做别的猜测
      decoded = lastSegment;
    }

    return safeNormalizeFileName(decoded) || `image-${index + 1}`;
  } catch {
    return `image-${index + 1}`;
  }
}

/**
 * 收集正文里的图片（按出现顺序、按绝对 URL 去重）。
 *
 * 跳过 data: 内联图（不下载，也不改写）；取不到可用 src 的 img 直接忽略 ——
 * 它们本来也不会出现在 Markdown 里。
 *
 * @returns {Array<{ url: string, baseName: string, nodes: HTMLImageElement[] }>}
 */
export function collectImages(contentDoc) {
  const byUrl = new Map();

  contentDoc.body.querySelectorAll('img').forEach((img) => {
    const raw = getBestImageSrc(img).trim();

    if (!raw || raw.startsWith('data:')) {
      return;
    }

    let absoluteUrl;

    try {
      absoluteUrl = new URL(raw, document.baseURI).href;
    } catch {
      return;
    }

    const existing = byUrl.get(absoluteUrl);

    if (existing) {
      existing.nodes.push(img);
      return;
    }

    byUrl.set(absoluteUrl, {
      url: absoluteUrl,
      baseName: urlBaseName(absoluteUrl, byUrl.size),
      nodes: [img]
    });
  });

  return Array.from(byUrl.values());
}

/**
 * 把已本地化的图片改写成包内相对路径（`assets/<名>`）：删掉 srcset、写 src。
 * 未在 localPathByUrl 里的图片保持原样 —— 那是「没勾选」或「下载失败」的图，
 * 在 Markdown 里仍指向远程地址。
 */
export function applyLocalSources(candidates, localPathByUrl) {
  candidates.forEach((candidate) => {
    const localPath = localPathByUrl.get(candidate.url);

    if (!localPath) {
      return;
    }

    candidate.nodes.forEach((img) => {
      img.removeAttribute('srcset');
      img.setAttribute('src', localPath);
    });
  });
}

/** 净化（并已改写图片链接）的正文 HTML → Markdown */
export function buildMarkdown(html) {
  return createMarkdownContent(html, document.URL);
}
