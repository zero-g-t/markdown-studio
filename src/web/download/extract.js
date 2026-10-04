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
 *
 *   4. 记录页面「实际渲染出来的图片宽度」，把被缩小显示过的图写成 HTML <img width>（见
 *      collectRenderedImageSizes / stageSizedImages）。落盘的是原图，页面上很多图是缩略显示
 *      （豆包消息里的参考图就是典型），只写 `![](assets/…)` 的话预览会按自然尺寸渲染成巨型图。
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
 * 记录页面上每张图「实际渲染出来的宽度」（CSS px，按绝对 URL 建索引）。
 *
 * 落盘的是原图，而页面上不少图是缩小显示的（消息里的参考图、列表封面等），
 * 只写 `![](assets/…)` 的话预览会按图片自然尺寸渲染，看上去「超级大」。
 *
 * 只记录确实被缩小显示的图，其余不记（保持纯 Markdown 图片语法）：
 *   · naturalWidth 为 0 的图（还没加载完 / 懒加载占位）不记 —— 它的盒子尺寸没有参考价值；
 *   · 显示宽度不小于自然宽度的图不记 —— 它本来就和网页上一样大。
 * 宁可给不出宽度，也不给一个错的。
 */
export function collectRenderedImageSizes(root = document) {
  const widths = new Map();

  root.querySelectorAll('img').forEach((img) => {
    const raw = getBestImageSrc(img).trim();

    if (!raw || raw.startsWith('data:') || img.naturalWidth <= 0) {
      return;
    }

    const width = Math.round(img.getBoundingClientRect().width);

    if (width < 1 || img.naturalWidth - width < 2) {
      return;
    }

    let absoluteUrl;

    try {
      absoluteUrl = new URL(raw, document.baseURI).href;
    } catch {
      return;
    }

    // 同一张图在页面上可能显示多次（缩略图 + 大图）：Markdown 里同一路径只能有一个宽度，
    // 取显示得最大的那次，更接近正文里看到的大小。
    if (width > (widths.get(absoluteUrl) || 0)) {
      widths.set(absoluteUrl, width);
    }
  });

  return widths;
}

/**
 * 收集正文里的图片（按出现顺序、按绝对 URL 去重）。
 *
 * 跳过 data: 内联图（不下载，也不改写）；取不到可用 src 的 img 直接忽略 ——
 * 它们本来也不会出现在 Markdown 里。
 *
 * @param {Document} contentDoc 净化后的正文文档
 * @param {Map<string, number>} renderedWidths collectRenderedImageSizes 的结果（绝对 URL → 显示宽度）
 * @returns {Array<{ url: string, baseName: string, nodes: HTMLImageElement[], renderedWidth: number|null }>}
 */
export function collectImages(contentDoc, renderedWidths = new Map()) {
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
      nodes: [img],
      renderedWidth: renderedWidths.get(absoluteUrl) ?? null
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
 * Markdown 图片语法（`![alt](path)`）表达不了尺寸，而本项目的编辑器预览用
 * markdown-it({ html: true }) 渲染、原样放行 HTML，所以「页面上被缩小显示过的图」
 * 改写成 HTML <img>。
 *
 * 做法是占位符：序列化前把 img 节点换成私有区字符占位，转完 Markdown 再把占位还原成标签，
 * 而不是去正则匹配/改写 `![alt](assets/…)` —— 文件名里的括号、空格、逗号都会被 Markdown
 * 的转义规则改写（defuddle 会把 `(` 转义成 `\(`、含空格的路径包进 `<>`），按字符串找回去很容易漏。
 *
 * 只给 width、不给 height：高度交给浏览器按图片自身比例算，避免页面用 CSS 裁剪过这张图时
 * 把落盘的图拉伸变形；宽度一致就已经是「和网页上看到的一样大」。
 */
const IMAGE_PLACEHOLDER_PREFIX = '\uE000';
const IMAGE_PLACEHOLDER_SUFFIX = '\uE001';

const escapeAttribute = (value) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * 把「已本地化 + 页面缩小显示过」的图换成占位符。
 *
 * @param {Document} contentDoc 已改写 src 的正文文档
 * @param {Map<string, number>} widthByLocalPath 包内路径（assets/<名>）→ 页面显示宽度
 * @returns {Map<string, string>} 占位符 → HTML <img> 标签
 */
export function stageSizedImages(contentDoc, widthByLocalPath) {
  const htmlByPlaceholder = new Map();

  contentDoc.body.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    const width = widthByLocalPath.get(src);

    if (!width) {
      return;
    }

    const placeholder = `${IMAGE_PLACEHOLDER_PREFIX}${htmlByPlaceholder.size}${IMAGE_PLACEHOLDER_SUFFIX}`;
    const alt = img.getAttribute('alt') || '';

    htmlByPlaceholder.set(
      placeholder,
      `<img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" width="${width}">`
    );
    img.parentNode.replaceChild(contentDoc.createTextNode(placeholder), img);
  });

  return htmlByPlaceholder;
}

/** 把占位符还原成 HTML <img> 标签（必须在 Markdown 转换之后调用） */
export function restoreSizedImages(markdown, htmlByPlaceholder) {
  let result = markdown;

  htmlByPlaceholder.forEach((tag, placeholder) => {
    result = result.replaceAll(placeholder, tag);
  });

  return result;
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
