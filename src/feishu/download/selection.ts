/*
 * 下载清单与勾选（MAIN world）。
 *
 * 上游 main() 在 docx.intoMarkdownAST() 之后直奔下载。本模块插在中间：
 *   1. 把待下载清单（图片 / 画板与图表 / 附件）报给悬浮 UI；
 *   2. 等用户勾选（同一 bundle 内的 Promise，由 window message 唤醒，不依赖跨 world 时序）；
 *   3. 按勾选结果原地过滤 images / files —— 不碰 root，所以未勾选项在 Markdown 里
 *      仍是上游那个空链接形态（`[名字]()`），且不会进 zip；
 *   4. 用户取消时抛 AbortError，走上游自己的中止路径（不产生错误提示，干净退出）。
 *
 * 清单与下载由同一次提取产出，不会出现「清单没列、下载却下了」的漏项。
 */
import type { mdast } from '@dolphin/lark';
import { FEISHU_EVENT, MANIFEST_GROUP, POST_MESSAGE_FLAG } from '../protocol';

export interface ManifestItem {
  id: string;
  group: string;
  name: string;
  size: number | null;
}

interface ItemEntry {
  item: ManifestItem;
  node: mdast.Image | mdast.Link;
}

interface SelectionAnswer {
  selectedIds: string[];
  cancelled: boolean;
}

// 附件体积只读响应头、不读 body；并发探针上限
const PROBE_CONCURRENCY = 4;

let pendingSelection: ((answer: SelectionAnswer) => void) | null = null;

const post = (event: string, payload: Record<string, unknown>): void => {
  window.postMessage({ [POST_MESSAGE_FLAG]: true, event, ...payload }, '*');
};

const ensureSelectionListener = (): void => {
  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data as Record<string, unknown> | null;
    if (!data || data[POST_MESSAGE_FLAG] !== true) {
      return;
    }
    if (data.event !== FEISHU_EVENT.SELECTION) {
      return;
    }

    const resolve = pendingSelection;
    if (!resolve) {
      return;
    }

    pendingSelection = null;
    resolve({
      selectedIds: Array.isArray(data.selectedIds) ? (data.selectedIds as string[]) : [],
      cancelled: data.cancelled === true
    });
  });
};

// 读完响应头立刻 abort：只为拿 Content-Length，不传输 body
const probeFileSize = async (file: mdast.Link): Promise<number | null> => {
  const fetchFile = file.data?.fetchFile;
  if (!fetchFile) {
    return null;
  }

  const controller = new AbortController();

  try {
    const response = await fetchFile({ signal: controller.signal });
    const contentLength = Number(response.headers.get('content-length'));

    return Number.isFinite(contentLength) && contentLength > 0 ? contentLength : null;
  } catch {
    // 探测失败 = 体积未知，如实显示「未知」，不影响下载
    return null;
  } finally {
    controller.abort();
  }
};

const probeSizes = async (entries: ItemEntry[]): Promise<void> => {
  const queue = [...entries];

  await Promise.all(
    Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, async () => {
      for (let entry = queue.shift(); entry; entry = queue.shift()) {
        entry.item.size = await probeFileSize(entry.node as mdast.Link);
      }
    })
  );
};

const buildEntries = (payload: { images: mdast.Image[]; files: mdast.Link[] }): ItemEntry[] => {
  const imageEntries = payload.images.map((node, index) => {
    const isDiagram = typeof node.data?.fetchBlob === 'function';

    return {
      node: node as mdast.Image | mdast.Link,
      item: {
        id: `i:${index}`,
        group: isDiagram ? MANIFEST_GROUP.DIAGRAM : MANIFEST_GROUP.IMAGE,
        name: isDiagram ? node.alt || `画板/图表 ${index + 1}` : node.data?.name || `图片 ${index + 1}`,
        size: null
      }
    };
  });

  const fileEntries = payload.files.map((node, index) => ({
    node: node as mdast.Image | mdast.Link,
    item: {
      id: `f:${index}`,
      group: MANIFEST_GROUP.FILE,
      name: node.data?.name || `附件 ${index + 1}`,
      size: null
    }
  }));

  return [...imageEntries, ...fileEntries];
};

// 原地替换：调用方持有的数组即被过滤，root 不受影响（未勾选项在 Markdown 里保持空链接）
const keepSelected = <T extends mdast.Image | mdast.Link>(
  nodes: T[],
  entries: ItemEntry[],
  selected: Set<string>
): void => {
  const kept = entries.filter((entry) => selected.has(entry.item.id)).map((entry) => entry.node as T);

  nodes.splice(0, nodes.length, ...kept);
};

export const applyDownloadSelection = async (payload: {
  images: mdast.Image[];
  files: mdast.Link[];
}): Promise<void> => {
  const entries = buildEntries(payload);

  await probeSizes(entries.filter((entry) => entry.item.group === MANIFEST_GROUP.FILE));

  ensureSelectionListener();
  post(FEISHU_EVENT.MANIFEST, { items: entries.map((entry) => entry.item) });

  const answer = await new Promise<SelectionAnswer>((resolve) => {
    pendingSelection = resolve;
  });

  if (answer.cancelled) {
    // 走上游的中止路径：main() 的 catch 认 AbortError 后直接停手，不产生错误提示
    throw new DOMException('用户取消了下载选择', 'AbortError');
  }

  const selected = new Set(answer.selectedIds);
  keepSelected(payload.images, entries.slice(0, payload.images.length), selected);
  keepSelected(payload.files, entries.slice(payload.images.length), selected);
};
