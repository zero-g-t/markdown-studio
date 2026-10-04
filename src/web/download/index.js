/*
 * 通用网页分支的 MAIN world 入口（与飞书分支 src/feishu/download/index.js 并列）。
 *
 * 流程：
 *   提取正文 → 收集正文图片（记下页面上实际渲染的宽度）→ 清单勾选 → 下载勾选图片
 *   → 把 img 改写成 assets/<名> → 链接内部块级容器降级为行内
 *   → 页面缩小显示过的图写成 HTML <img width>，其余照旧 → 转 Markdown
 *   → 写入「默认下载目录/<标题>/」（<标题>.md + assets/）→ 自动在新标签页打开 md
 *
 * 提取与转换照搬 obsidian-clipper 的「保存为 Markdown」（defuddle + turndown），
 * 图片本地化与清单勾选是本项目在它之上叠加的部分。
 *
 * 约定：
 *   · 用户在清单里点「取消」→ requestManifestSelection 抛 AbortError → 静默退出，
 *     不发 FAILED（悬浮 UI 自己已经把状态恢复成可重来）；
 *   · 单张图片下载失败 → 该图在 Markdown 里保留远程链接，并在进度面板与完成文案里
 *     如实说明失败数量。不重试、不兜底、不自动补救；
 *   · 图片传输路径：同源走页面 fetch；跨域先页面 fetch（带页面 Referer，防盗链站点认这个），
 *     仅当响应「规范上不可读」时才改由 Service Worker 代抓（见 images.js）；
 *     服务器返回的错误码一律如实上报，不换通道、不重试；
 *   · 进度事件用 'image' 作 key，悬浮 UI 的圆环才会聚合出百分比。
 */
import { requestManifestSelection } from '@/feishu/download/selection';
import { saveClipToFolder } from '@/feishu/download/save';
import { safeNormalizeFileName } from '@/lib/utils';
import { MANIFEST_GROUP } from '../../feishu/protocol.js';
import {
  entry,
  IMAGE_PROGRESS_KEY,
  PROBE_PROGRESS_KEY,
  postDone,
  postFailed,
  postProgress
} from './progress.js';
import {
  applyLocalSources,
  buildMarkdown,
  collectImages,
  collectRenderedImageSizes,
  flattenShadowDom,
  normalizeLinkContent,
  parsePage,
  readContentDocument,
  restoreSizedImages,
  serializeContent,
  stageSizedImages
} from './extract.js';
import { downloadImages, ensureExtension, probeImageSizes } from './images.js';
import { collectDeclaredSiteNames, pickPageTitle } from './title.js';

const ASSET_DIR = 'assets';
const FALLBACK_TITLE = 'Untitled';

/**
 * 同一批图片可能撞名（不同 URL 指向同名文件）。
 * 飞书分支用的是上游 vendored 的 UniqueFileName，但那个模块会连带把 lark 转换内核
 * 拉进本 bundle，所以这里保留同一套命名规则、局部实现。
 */
class UniqueFileName {
  constructor() {
    this.used = new Set();
  }

  generate(name) {
    let candidate = name;
    let index = 1;

    while (this.used.has(candidate)) {
      const dotIndex = name.lastIndexOf('.');
      candidate = dotIndex > 0
        ? `${name.slice(0, dotIndex)}-${index}${name.slice(dotIndex)}`
        : `${name}-${index}`;
      index += 1;
    }

    this.used.add(candidate);

    return candidate;
  }
}

/*
 * 落盘标题：优先 defuddle 的 result.title，但它对应的 og:title 在部分站点被写成了站点名
 * （实测 chat.deepseek.com、www.doubao.com），那种情况下退回页签标题 —— 判定依据见 ./title.js。
 */
function resolveTitle(result) {
  return pickPageTitle({
    parsedTitle: result.title,
    documentTitle: document.title,
    declaredSiteNames: collectDeclaredSiteNames(document),
    hostname: location.hostname,
    fallback: FALLBACK_TITLE
  });
}

async function main() {
  postProgress([entry('extract', '正在提取网页正文…')]);

  flattenShadowDom(document);
  // 必须在 parsePage 之前取：尺寸来自页面真实布局，只对仍在文档里的 img 有效
  const renderedImageWidths = collectRenderedImageSizes(document);
  const result = parsePage(document);

  if (!result.content) {
    throw new Error('未能从当前网页提取到正文内容');
  }

  const contentDoc = readContentDocument(result.content);
  const candidates = collectImages(contentDoc, renderedImageWidths);

  // 清单：只在确实抓到图片时才让用户勾选；没有图片就直接进转换
  let selectedIds = null;

  if (candidates.length > 0) {
    // 清单里要和飞书一致地显示每个文件大小：先探测各图体积（只读 Content-Length）
    const sizes = await probeImageSizes(candidates.map((candidate) => candidate.url), (state) => {
      postProgress([
        entry(PROBE_PROGRESS_KEY, `正在读取图片大小 ${state.done}/${state.total}`)
      ]);
    });

    selectedIds = await requestManifestSelection(
      candidates.map((candidate, index) => ({
        id: `i:${index}`,
        group: MANIFEST_GROUP.IMAGE,
        name: candidate.baseName,
        size: sizes.get(candidate.url) ?? null
      }))
    );
  }

  const picked = candidates
    .map((candidate, index) => ({ candidate, id: `i:${index}` }))
    .filter((item) => selectedIds === null || selectedIds.has(item.id));

  let downloaded = { successes: [], failures: [] };

  if (picked.length > 0) {
    postProgress([entry(IMAGE_PROGRESS_KEY, `正在下载图片 0/${picked.length}`, { percent: 0 })]);

    downloaded = await downloadImages(
      picked.map((item) => item.candidate.url),
      (state) => {
        postProgress([
          entry(IMAGE_PROGRESS_KEY, `正在下载图片 ${state.done}/${state.total}`, {
            percent: Math.floor((state.done / state.total) * 100)
          })
        ]);
      }
    );
  }

  // 只有「勾选了 + 下载成功」的图片才本地化；其余（没勾选 / 下载失败）保持远程链接
  const uniqueName = new UniqueFileName();
  const localPathByUrl = new Map();
  const widthByLocalPath = new Map();
  const assets = [];

  picked.forEach((item) => {
    const success = downloaded.successes.find((entryItem) => entryItem.url === item.candidate.url);

    if (!success) {
      return;
    }

    const name = uniqueName.generate(
      ensureExtension(item.candidate.baseName, success.contentType)
    );
    const path = `${ASSET_DIR}/${name}`;

    localPathByUrl.set(item.candidate.url, path);
    assets.push({ path, blob: success.blob });

    // 页面上是缩小显示的图：把显示宽度带进 Markdown（见 extract.js stageSizedImages）
    if (item.candidate.renderedWidth) {
      widthByLocalPath.set(path, item.candidate.renderedWidth);
    }
  });

  applyLocalSources(candidates, localPathByUrl);
  normalizeLinkContent(contentDoc);
  const sizedImages = stageSizedImages(contentDoc, widthByLocalPath);
  const markdown = restoreSizedImages(buildMarkdown(serializeContent(contentDoc)), sizedImages);

  const baseName = safeNormalizeFileName(resolveTitle(result));
  const markdownName = `${baseName}.md`;
  const failureNote = downloaded.failures.length > 0
    ? `；${downloaded.failures.length} 张图片下载失败，已在 Markdown 中保留原链接`
    : '';

  postProgress([entry('save', '正在保存到本地文件夹…')]);

  // 落盘与「写完自动打开 md」都在这里完成：具体通道见 src/feishu/download/save.ts
  await saveClipToFolder({ folder: baseName, markdownName, markdown, assets });

  const message = `已保存到「下载目录/${baseName}/」并已在浏览器打开${assets.length > 0 ? `（含 ${assets.length} 张图片）` : ''}${failureNote}`;
  const finalEntries = [entry('done', message, { level: 'success' })];

  downloaded.failures.forEach((failure) => {
    finalEntries.push(
      entry(`image-failed:${failure.url}`, `图片下载失败：${failure.url}（${failure.reason}）`, {
        level: 'error'
      })
    );
  });

  postDone(message, finalEntries);
}

main().catch((error) => {
  // 用户在清单里点了取消：静默退出，不上报失败
  if (error?.name === 'AbortError') {
    return;
  }

  const message = error?.message || String(error);
  postFailed(message, [entry('error', message, { level: 'error' })]);
});
