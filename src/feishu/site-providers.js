/*
 * 站点适配器（site provider）注册表。
 *
 * 一个 provider 描述「某个网站上的页面可以被转换成 Markdown 并下载」这一能力：
 *   - matches(url)  该 URL 是否由本适配器接管（决定右下角悬浮按钮是否挂载）
 *   - bundle        MAIN world 注入脚本路径（真正干活的转换器）
 *
 * 目前有两条并列链路：
 *   1. 飞书文档页（feishuProvider）—— 上游 cloud-document-converter 转换器，
 *      依赖飞书页面运行时全局对象（window.PageMain / window.User / window.editor），
 *      非飞书文档页会直接判定失败；
 *   2. 通用网页（webProvider，兜底）—— 照搬 obsidian-clipper 的 defuddle 提取 +
 *      HTML→Markdown 转换，覆盖除飞书文档页之外的所有 http/https 网页。
 *
 * 匹配顺序即数组顺序（resolveProvider 取首个命中）：飞书更具体，必须排在前面，
 * 否则飞书文档页会被通用分支接管。
 */

import { webProvider } from '../web/site-provider.js';

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

// 顺序敏感：飞书更具体，必须排在通用网页前面
export const PROVIDERS = [feishuProvider, webProvider];

export function resolveProvider(url) {
  return PROVIDERS.find((provider) => provider.matches(url)) || null;
}
