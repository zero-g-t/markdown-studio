/*
 * 通用网页站点适配器（非飞书网页的兜底分支）。
 *
 * 与飞书分支并列：飞书文档页由 feishuProvider 优先命中，其余 http/https 网页落到这里。
 * 转换逻辑照搬 obsidian-clipper 的「保存为 Markdown」路径：
 *   flattenShadowDom → new Defuddle(document, { url }).parse() → createMarkdownContent(content, url)
 * 在此之上按本项目需要叠加「正文图片清单勾选 + 图片本地化（下载 + 改写为 assets/ + 打包 zip）」。
 *
 * 说明：本适配器只声明「谁来接管」与「注入哪个 bundle」，
 * 真正干活的转换器见 src/web/download/（被注入到 MAIN world）。
 */

export function isGenericWebUrl(urlStr) {
  try {
    const { protocol } = new URL(urlStr);

    // 只接管普通网页；chrome:、chrome-extension:、file:、about:、data: 等一律不接管
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export const webProvider = {
  id: 'web',
  label: '网页',
  bundle: 'bundles/web-download.js',
  matches: isGenericWebUrl,
  /*
   * 通用分支只在「正文里抓到图片」时才会上报待下载清单；
   * 无图片时不会进入 SELECTING 阶段，悬浮 UI 需要在收到第一条进度事件时
   * 直接从「扫描中」切到「正在转换为 Markdown」。飞书分支不设此标记。
   */
  skipManifestPhase: true
};
