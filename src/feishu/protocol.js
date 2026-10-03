/*
 * MAIN world（转换器）→ ISOLATED world（悬浮 UI）→ Service Worker 的消息契约。
 *
 * 为什么要跨 world 通信：转换器必须读飞书页面运行时全局对象（window.PageMain），
 * 只有 MAIN world 读得到；而悬浮 UI 需要 chrome.storage / chrome.runtime，
 * 只有 ISOLATED world（扩展上下文）能用。这与上游 cloud-document-converter 的架构一致。
 */

// 悬浮 UI → Service Worker：请求注入某个站点的转换器
export const RUNTIME_MESSAGE_SITE_DOWNLOAD = 'MD_STUDIO_SITE_DOWNLOAD';

/*
 * 悬浮 UI → Service Worker：请求用扩展权限代抓一张跨域图片。
 *
 * 为什么需要它：转换器跑在页面 MAIN world，那里的 fetch 受页面同源策略约束，
 * 没有 Access-Control-Allow-Origin 的跨域图（如 GitHub 的 camo.githubusercontent.com 反代）
 * 连响应体都读不到，只能报 "Failed to fetch"。Service Worker 持有 host_permissions，
 * 不受 CORS 限制，因此这类图由它取回二进制、base64 回传。
 *
 * 该常量在 public/background.js 里有一份同名字符串副本（public/ 下的脚本不经打包，无法 import），
 * 两边必须保持一致。
 */
export const RUNTIME_MESSAGE_FETCH_IMAGE = 'MD_STUDIO_FETCH_IMAGE';

// 转换器 → 悬浮 UI：window.postMessage 载荷上的标记，避免与页面自身消息混淆
export const POST_MESSAGE_FLAG = '__mdStudioFeishu';

export const FEISHU_EVENT = {
  // 下载过程中的实时状态快照
  PROGRESS: 'progress',
  // 扫描完成：待下载清单（MAIN → ISOLATED）
  MANIFEST: 'manifest',
  // 用户勾选结果（ISOLATED → MAIN）
  SELECTION: 'selection',
  // 成功落盘
  DONE: 'done',
  // 失败（含「这不是一个飞书文档页面」这类无法转换的情况）
  FAILED: 'failed',
  // 跨域图片代抓请求（MAIN → ISOLATED）：载荷 { requestId, url }
  FETCH_IMAGE: 'fetch-image',
  // 跨域图片代抓结果（ISOLATED → MAIN）：载荷 { requestId, ok, base64?, contentType?, error? }
  FETCH_IMAGE_RESULT: 'fetch-image-result'
};

/*
 * ManifestItem（FEISHU_EVENT.MANIFEST 载荷里的 items 元素）：
 *   {
 *     id: 'i:3' | 'f:2',                       // i = images 数组下标，f = files 数组下标
 *     group: 'image' | 'diagram' | 'file',
 *     name: string,                            // 飞书里的原始名称
 *     size: number | null                      // 仅附件探测；图片/画板渲染前不可知
 *   }
 *
 * id 里的下标是「docx.intoMarkdownAST() 返回的 images / files 数组下标」。
 * 清单与下载用的是同一次提取的同一批数组，所以下标必然对得上。
 */
export const MANIFEST_GROUP = {
  IMAGE: 'image',
  DIAGRAM: 'diagram',
  FILE: 'file'
};

/*
 * ProgressEntry 结构（由 src/feishu/download/toast-bridge.js 产出）：
 *   {
 *     key: string,                                        // 上游 Toast 的 key，用于去重
 *     content: string,                                    // 上游原文案（含百分比）
 *     level: 'loading' | 'success' | 'warning' | 'error' | 'info',
 *     percent?: number                                    // 从 content 中提取的真实百分比
 *   }
 *
 * 圆环进度只用「真实百分比」：上游给图片/附件两组各报一个百分比，
 * 对应的 key 恰好是 'image' 与 'file'（上游 TranslationKey.IMAGE / TranslationKey.FILE）。
 * 其余阶段（滚动加载、解析 AST、打包 zip）上游不报百分比，圆环显示旋转不确定态。
 */
export const AGGREGATE_PROGRESS_KEYS = ['image', 'file'];
