/*
 * 站点适配器（site provider）注册表。
 *
 * 一个 provider 描述「某个网站上的页面可以被转换成 Markdown 并下载」这一能力：
 *   - matches(url)  该 URL 是否由本适配器接管（决定右下角悬浮按钮是否挂载）
 *   - bundle        MAIN world 注入脚本路径（真正干活的转换器）
 *
 * v1 只实现飞书 —— 上游 cloud-document-converter 本身就是飞书专供：
 * 它的转换器依赖飞书页面运行时全局对象（window.PageMain / window.User / window.editor），
 * 非飞书文档页会直接判定失败。详见 docs/feishu-to-markdown-design.md 第 1 节。
 *
 * 预留的后续站点（本版不实现）：新增一个 provider 对象即可，
 * 内容脚本与 Service Worker 都会按同一份注册表工作。
 *   · 微信公众号  mp.weixin.qq.com
 *   · 微博        weibo.com
 */

const FEISHU_DOC_PATH_SEGMENTS = ['/docx/', '/wiki/', '/doc/'];

const FEISHU_HOST_SUFFIXES = [
  '.feishu.cn',
  '.feishu.net',
  '.larksuite.com',
  '.feishu-pre.net',
  '.larkoffice.com',
  '.larkenterprise.com'
];

// 搬自上游 apps/chrome-extension/src/content.ts 的同名判定，规则保持一致。
export function isFeishuDocUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname;
    const pathname = url.pathname;

    const isFeishuDomain = FEISHU_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
    if (!isFeishuDomain) {
      return false;
    }

    return FEISHU_DOC_PATH_SEGMENTS.some((segment) => pathname.includes(segment));
  } catch {
    return false;
  }
}

export const feishuProvider = {
  id: 'feishu',
  label: '飞书文档',
  bundle: 'bundles/feishu-download.js',
  matches: isFeishuDocUrl
};

export const PROVIDERS = [feishuProvider];

export function resolveProvider(url) {
  return PROVIDERS.find((provider) => provider.matches(url)) || null;
}
