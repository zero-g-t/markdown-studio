/*
 * 通用网页分支的 MAIN world 入口（与飞书分支 src/feishu/download/index.js 并列）。
 *
 * 流程：
 *   提取正文 → 收集正文图片 → 清单勾选 → 下载勾选图片 → 把 img 改写成 assets/<名>
 *   → 转 Markdown → 有图打 zip（<标题>.md + assets/）、无图直接给 <标题>.md → 落盘
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
import { BlobReader, TextReader, ZipWriter, configure } from '@zip.js/zip.js';
import { legacyFileSave } from '@/common/legacy';
import { requestManifestSelection } from '@/feishu/download/selection';
import { safeNormalizeFileName } from '@/lib/utils';
import { MANIFEST_GROUP } from '../../feishu/protocol.js';
import { entry, IMAGE_PROGRESS_KEY, postDone, postFailed, postProgress } from './progress.js';
import {
  applyLocalSources,
  buildMarkdown,
  collectImages,
  flattenShadowDom,
  parsePage,
  readContentDocument,
  serializeContent
} from './extract.js';
import { downloadImages, ensureExtension } from './images.js';

// MAIN world 下 Worker 容易受页面 CSP 限制。飞书 bundle 里的同名 configure 不跨 bundle 生效，
// 这里是独立注入的另一份 zip.js 实例，必须自己关一次。
configure({ useWebWorkers: false });

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

function resolveTitle(result) {
  return (result.title || document.title || FALLBACK_TITLE).trim() || FALLBACK_TITLE;
}

async function main() {
  postProgress([entry('extract', '正在提取网页正文…')]);

  flattenShadowDom(document);
  const result = parsePage(document);

  if (!result.content) {
    throw new Error('未能从当前网页提取到正文内容');
  }

  const contentDoc = readContentDocument(result.content);
  const candidates = collectImages(contentDoc);

  // 清单：只在确实抓到图片时才让用户勾选；没有图片就直接进转换
  let selectedIds = null;

  if (candidates.length > 0) {
    selectedIds = await requestManifestSelection(
      candidates.map((candidate, index) => ({
        id: `i:${index}`,
        group: MANIFEST_GROUP.IMAGE,
        name: candidate.baseName,
        size: null
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
  });

  applyLocalSources(candidates, localPathByUrl);
  const markdown = buildMarkdown(serializeContent(contentDoc));

  const baseName = safeNormalizeFileName(resolveTitle(result));
  const markdownName = `${baseName}.md`;
  const failureNote = downloaded.failures.length > 0
    ? `；${downloaded.failures.length} 张图片下载失败，已在 Markdown 中保留原链接`
    : '';

  let blob;
  let outputName;

  if (assets.length > 0) {
    /*
     * 打包用 zip.js 低层 API（顺序写入），不用 `new fs.FS().exportBlob()`：
     * exportBlob 走 zip-fs 的并发导出层，子条目失败会被 `throw errorResult.reason` 原样再抛，
     * 而里层多处流拆除是无原因调用（abort()/error(reason)），失败原因会退化成 undefined ——
     * 上层只能看到「无原因的拒绝」（飞书分支已实测踩到）。低层顺序写不会吞掉错误，
     * 条目名保持 `assets/<名>` 与 `<标题>.md` 不变。
     */
    /*
     * 输出侧不用 `BlobWriter`：它的内部临时 blob 机制在 Chrome 下输出超过约 10MiB 就会失败，
     * 并把错误吞成「无原因的 undefined 拒绝」（zip.js 2.22.0 实测；同一份代码在 Node 下不复现）。
     * 改用普通 WritableStream 收分片、最后自己拼 Blob：实测 12MB 单条 / 18MB 三条均正常。
     */
    const zipChunks = [];
    const zipWriter = new ZipWriter(
      new WritableStream({
        write(chunk) {
          zipChunks.push(chunk);
        }
      })
    );

    await zipWriter.add(markdownName, new TextReader(markdown));

    for (const asset of assets) {
      await zipWriter.add(asset.path, new BlobReader(asset.blob));
    }

    await zipWriter.close();
    blob = new Blob(zipChunks, { type: 'application/zip' });
    outputName = `${baseName}.zip`;
  } else {
    blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    outputName = markdownName;
  }

  legacyFileSave(blob, { fileName: outputName });

  const message = `已下载 ${outputName}${assets.length > 0 ? `（含 ${assets.length} 张图片）` : ''}${failureNote}`;
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
