/*
 * 「保存到哪个目录」用的标题。
 *
 * 标题取自 defuddle 的 result.title，它的候选顺序是：
 *   og:title → twitter:title → schema headline → <title> → <h1>
 * og:title 的优先级高于页签标题（<title>），而不少站点（尤其会话型/中文站点）把 og:title
 * 直接写成站点名，于是「页签标题」永远轮不到：
 *   · chat.deepseek.com：<meta property="og:title" content="DeepSeek">，
 *     页签是「Markdown链接语法判断 - Deepseek」，落盘目录却成了 DeepSeek；
 *   · www.doubao.com/chat/<id>：<meta property="og:title" content="豆包">，
 *     且没有 og:site_name / application-name，落盘目录成了「豆包」。
 *
 * defuddle 自己有一道「候选文本等于站点标识就跳过」的过滤（metadata.js getBestTitle），
 * 但它认的站点标识只有 og:site_name / schema / author，以及「域名去掉最后一段」——
 * chat.deepseek.com 归一化出来是 chatdeepseek，和 DeepSeek 不相等，过滤没能生效。
 *
 * 这里补两道与语言无关的判定，命中即认为 result.title 是站点级名称，退回页签标题
 * （document.title）；都不命中就照用 result.title。判定全是纯比较，不做字符串裁剪。
 *
 *   A. 等于页面声明的站点名（og:site_name / application-name）或域名品牌标签
 *      （chat.deepseek.com → deepseek）。比较时只做小写与空白归一，保留汉字 ——
 *      早先版本把所有非字母数字都删掉，中文站点名会被删成空串，永远不可能命中。
 *   B. 等于页签标题按分隔符切出的「次要片段」：站点名总是这种短段
 *      （「豆包 - 字节跳动旗下 AI 智能助手」「会话名 - Deepseek」），
 *      而正文型页面是「长正文标题 - 短站点名」，命中的是长的那段，不会触发。
 *
 * 已知代价：B 对「短正文标题 + 更长站点名」的页面（如「Docs - Acme Corporation」）
 * 会把站点名一起带进目录名。这类页面本来就拿不到额外信息，权衡后按「退回页签标题」处理。
 *
 * 本模块不 import 任何东西，可以直接用 node 跑，便于对着真实输入验证判定结果。
 */

/** 标题比较口径：小写 + 去掉所有空白（含全角空格），汉字原样保留 */
function normalizeTitleText(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, '');
}

/*
 * 标题里的分隔符：与 defuddle 的 cleanTitle 同一套（| - – — / ·），
 * 另加中文站点常用的全角竖线、全角冒号、下划线与间隔号。
 * 连字符在词内（GPT-4）会把片段切碎，那只会让 B 少触发，不会误判。
 */
const TITLE_SEPARATOR = /[|\-–—_/·:：｜•]+/;

/**
 * 页面 meta 里声明的站点名（og:site_name / application-name）。
 * 收 doc 参数而不是直接用全局 document：调用方传真实文档，验证时可传桩。
 */
export function collectDeclaredSiteNames(doc) {
  return ['meta[property="og:site_name" i]', 'meta[name="application-name" i]']
    .map((selector) => doc.querySelector(selector)?.getAttribute('content')?.trim() || '')
    .filter(Boolean);
}

/**
 * 站点标识集合：meta 声明的站点名 + 域名品牌标签。
 * 品牌标签取「去掉最后一段后的末段」：chat.deepseek.com → deepseek，example.com → example。
 * 纯数字段（IP 主机名）不作为标识，避免产出一个毫无意义的数字。
 */
export function siteIdentifiers({ declaredSiteNames = [], hostname = '' } = {}) {
  const identifiers = new Set(declaredSiteNames.map(normalizeTitleText).filter(Boolean));
  const labels = String(hostname).toLowerCase().split('.').filter(Boolean);
  const brand = labels.length >= 2 ? labels[labels.length - 2] : labels[0];

  if (brand && !/^\d+$/.test(brand)) {
    identifiers.add(normalizeTitleText(brand));
  }

  return identifiers;
}

/** 判定 B：parsedTitle 是否是页签标题里被别的片段压过的那一段（即短的那段） */
function isMinorSegmentOfDocumentTitle(parsedTitle, documentTitle) {
  const parsed = normalizeTitleText(parsedTitle);

  if (!parsed) {
    return false;
  }

  const segments = String(documentTitle ?? '')
    .split(TITLE_SEPARATOR)
    .map(normalizeTitleText)
    .filter(Boolean);

  if (segments.length < 2) {
    return false;
  }

  const longest = segments.reduce((longestSegment, segment) =>
    segment.length > longestSegment.length ? segment : longestSegment
  );

  return segments.includes(parsed) && parsed.length < longest.length;
}

/** 选定落盘用的标题：parsedTitle 不是站点级名称就用它，否则退回页签标题 */
export function pickPageTitle({
  parsedTitle = '',
  documentTitle = '',
  declaredSiteNames = [],
  hostname = '',
  fallback = 'Untitled'
} = {}) {
  const parsed = String(parsedTitle).trim();
  const tabTitle = String(documentTitle).trim();

  if (parsed) {
    const isSiteName =
      siteIdentifiers({ declaredSiteNames, hostname }).has(normalizeTitleText(parsed)) ||
      isMinorSegmentOfDocumentTitle(parsed, tabTitle);

    if (!isSiteName) {
      return parsed;
    }
  }

  return tabTitle || parsed || fallback;
}
