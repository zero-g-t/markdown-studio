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
 *
 *   3. 转换前把链接内部的容器型块级元素降级为行内 span（见 normalizeLinkContent），
 *      否则 turndown 的块级换行会落进链接文本，产出 `[\n\n标题\n\n](url)` 这种坏链接。
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

/*
 * 链接内部的「容器型块级标签」。页面常把导航项/会话标题写成
 * `<a href="…"><div>标题</div></a>`，turndown 会把块级元素前后的换行原样塞进链接文本，
 * 产出 `[\n\n标题\n\n](url)` 这种坏链接（deepseek 会话列表页实测）。
 * 链接本身是行内语义，把容器降级成 span，块级换行就不再产生。
 *
 * 结构性标签（ul/ol/li/table/pre/blockquote 等）不降级：它们承载真实结构，
 * 强行行内化会破坏 Markdown。
 */
const LINK_CONTAINER_BLOCK_TAGS = [
  'address', 'article', 'aside', 'div', 'dl', 'dt', 'dd', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'main', 'nav',
  'p', 'section'
];

const LINK_CONTAINER_SELECTOR = LINK_CONTAINER_BLOCK_TAGS.join(',');

/**
 * 相邻节点在指定边缘是否已经是空白。
 * 注释节点算空白；无文本但有元素子节点的（img/svg 图标等）算非空白 —— 视觉上需要间隔。
 */
function edgeIsWhitespace(node, edge) {
  if (!node || node.nodeType === 8 /* COMMENT_NODE */) {
    return true;
  }

  const text = node.textContent || '';

  if (text) {
    return edge === 'end' ? /\s$/.test(text) : /^\s/.test(text);
  }

  return !Array.from(node.childNodes || []).some((child) => child.nodeType === 1);
}

/** 把链接内的容器型块级元素换成同一棵子树的 span；相邻内容无空白时补一个空格，避免「标题时间」粘连 */
function demoteBlockContainers(anchor, contentDoc) {
  anchor.querySelectorAll(LINK_CONTAINER_SELECTOR).forEach((element) => {
    const span = contentDoc.createElement('span');

    for (const attribute of Array.from(element.attributes)) {
      span.setAttribute(attribute.name, attribute.value);
    }

    while (element.firstChild) {
      span.appendChild(element.firstChild);
    }

    const needsSpaceBefore = element.previousSibling && !edgeIsWhitespace(element.previousSibling, 'end');
    const needsSpaceAfter = element.nextSibling && !edgeIsWhitespace(element.nextSibling, 'start');
    const parent = element.parentNode;

    parent.replaceChild(span, element);

    if (needsSpaceBefore) {
      parent.insertBefore(contentDoc.createTextNode(' '), span);
    }

    if (needsSpaceAfter) {
      parent.insertBefore(contentDoc.createTextNode(' '), span.nextSibling);
    }
  });
}

/** 按文档序收集子树里的文本节点（不用 TreeWalker：测试环境的 domino 未实现它） */
function collectTextNodes(root) {
  const textNodes = [];

  const visit = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3 /* TEXT_NODE */) {
        textNodes.push(child);
      } else if (child.nodeType === 1 /* ELEMENT_NODE */) {
        visit(child);
      }
    }
  };

  visit(root);

  return textNodes;
}

/**
 * 取指定边缘的「第一个文本节点」：沿首/末子节点链深入，忽略纯元素层级。
 * 只用于裁掉链接内容最外侧的空白 —— 若按「子树里第一个文本节点」来裁，
 * 会误删链接内相邻内容之间的分隔空格（如图片与标题之间）。
 */
function edgeTextNode(node, edge) {
  let current = node || null;

  while (current && current.nodeType !== 3 /* TEXT_NODE */) {
    current = edge === 'start' ? current.firstChild : current.lastChild;
  }

  return current;
}

/** 链接文本内的连续空白折叠成单个空格，并去掉内容最外侧的空白（turndown 不折叠行内空白） */
function collapseAnchorWhitespace(anchor) {
  collectTextNodes(anchor).forEach((node) => {
    node.data = node.data.replace(/\s+/g, ' ');
  });

  const startText = edgeTextNode(anchor.firstChild, 'start');
  const endText = edgeTextNode(anchor.lastChild, 'end');

  if (startText) {
    startText.data = startText.data.replace(/^\s+/, '');
  }

  if (endText) {
    endText.data = endText.data.replace(/\s+$/, '');
  }
}

/**
 * 净化链接内部：容器型块级元素降级为行内 span + 折叠链接文本空白。
 * 由调用方在图片改写之后、序列化之前执行（只改标签与文本，img 节点本身不动）。
 */
export function normalizeLinkContent(contentDoc) {
  contentDoc.body.querySelectorAll('a').forEach((anchor) => {
    demoteBlockContainers(anchor, contentDoc);
    collapseAnchorWhitespace(anchor);
  });
}

/** 净化（并已改写图片链接）的正文 HTML → Markdown */
export function buildMarkdown(html) {
  return createMarkdownContent(html, document.URL);
}
