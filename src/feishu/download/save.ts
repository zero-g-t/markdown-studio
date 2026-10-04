/*
 * 提取结果落盘（MAIN world ↔ ISOLATED world ↔ Service Worker），飞书分支与通用网页分支共用。
 *
 * 为什么不能就地落盘：转换器跑在页面的 MAIN world，拿不到 chrome.*；而「在浏览器默认下载目录下
 * 建 `<标题>/` 子文件夹」只能由 chrome.downloads 完成 —— `<a download>` 的路径分隔符会被浏览器
 * 抹掉，做不出子目录。所以字节要经 window.postMessage 交给悬浮 UI（ISOLATED world），
 * 再由它转给 Service Worker。
 *
 * 传输格式：runtime 消息只接受可序列化值，二进制一律 base64；**一个文件一条消息**，
 * 既避开单条消息的体积上限，也让每个文件的成败都能单独如实上报。
 *
 * 顺序：先写 assets/ 下的图片，最后写 Markdown —— 中途失败会抛错，不会留下一个
 * 「指向不存在图片的 md」。失败一律带明确原因抛出，不重试、不做清理补偿，由调用方如实上报。
 */
import { FEISHU_EVENT, POST_MESSAGE_FLAG } from '../protocol';

export interface ClipAsset {
  /** 相对「<标题>/」的路径，形如 assets/x.png */
  path: string;
  blob: Blob;
}

export interface SaveClipOptions {
  /** 目标文件夹名（不含路径分隔符） */
  folder: string;
  /** Markdown 文件名，形如 <标题>.md */
  markdownName: string;
  markdown: string;
  assets: ClipAsset[];
}

export interface SaveClipResult {
  folder: string;
  /** 实际落盘的 Markdown 绝对路径（由 chrome.downloads 返回） */
  markdownPath: string;
}

interface SaveReply {
  ok: boolean;
  error?: string;
  filename?: string;
  downloadId?: number;
}

// 等悬浮 UI 回执的上限：正常链路毫秒级返回，超时只可能是悬浮 UI 缺席 —— 如实报错，不重发
const REPLY_TIMEOUT_MS = 2 * 60 * 1000;

// base64 每轮处理的字节数：分块是为了避开 String.fromCharCode 的参数个数上限
const BASE64_CHUNK_SIZE = 0x8000;

let requestSeq = 0;
let listenerInstalled = false;
const pending = new Map<string, (reply: SaveReply) => void>();

const ensureReplyListener = (): void => {
  if (listenerInstalled) {
    return;
  }

  listenerInstalled = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data as Record<string, unknown> | null;

    if (!data || data[POST_MESSAGE_FLAG] !== true || data.event !== FEISHU_EVENT.SAVE_RESULT) {
      return;
    }

    const resolve = pending.get(data.requestId as string);

    if (!resolve) {
      return;
    }

    pending.delete(data.requestId as string);
    resolve({
      ok: data.ok === true,
      error: typeof data.error === 'string' ? data.error : undefined,
      filename: typeof data.filename === 'string' ? data.filename : undefined,
      downloadId: typeof data.downloadId === 'number' ? data.downloadId : undefined
    });
  });
};

const request = (event: string, payload: Record<string, unknown>): Promise<SaveReply> =>
  new Promise((resolve, reject) => {
    requestSeq += 1;
    const requestId = `save-${requestSeq}`;
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('等待扩展写入本地文件超时'));
    }, REPLY_TIMEOUT_MS);

    pending.set(requestId, (reply) => {
      clearTimeout(timer);
      resolve(reply);
    });

    window.postMessage({ [POST_MESSAGE_FLAG]: true, event, requestId, ...payload }, '*');
  });

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';

  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(offset, offset + BASE64_CHUNK_SIZE) as unknown as number[]
    );
  }

  return btoa(binary);
};

const blobToBase64 = async (blob: Blob): Promise<string> =>
  bytesToBase64(new Uint8Array(await blob.arrayBuffer()));

const textToBase64 = (text: string): string => bytesToBase64(new TextEncoder().encode(text));

const describe = (reason: string | undefined): string => reason || '未知原因';

/**
 * 把 Markdown 与本地化图片写入「默认下载目录/<folder>/」，写完把 Markdown 在新标签页打开。
 *
 * 同名文件按覆盖处理（见 public/background.js 的 conflictAction）：同一标题重新下载时，
 * md 里引用的 `assets/` 路径与磁盘上的文件名才能始终对得上。
 */
export const saveClipToFolder = async (options: SaveClipOptions): Promise<SaveClipResult> => {
  ensureReplyListener();

  const { folder, markdownName, markdown, assets } = options;

  for (const asset of assets) {
    const reply = await request(FEISHU_EVENT.SAVE, {
      folder,
      path: asset.path,
      mime: asset.blob.type || 'application/octet-stream',
      base64: await blobToBase64(asset.blob)
    });

    if (!reply.ok) {
      throw new Error(`写入 ${asset.path} 失败：${describe(reply.error)}`);
    }
  }

  const markdownReply = await request(FEISHU_EVENT.SAVE, {
    folder,
    path: markdownName,
    mime: 'text/markdown',
    base64: textToBase64(markdown)
  });

  if (!markdownReply.ok) {
    throw new Error(`写入 ${markdownName} 失败：${describe(markdownReply.error)}`);
  }

  const openReply = await request(FEISHU_EVENT.SAVE_FINISH, {
    folder,
    path: markdownName,
    downloadId: markdownReply.downloadId
  });

  if (!openReply.ok) {
    throw new Error(`打开 ${markdownName} 失败：${describe(openReply.error)}`);
  }

  return {
    folder,
    markdownPath: openReply.filename || markdownReply.filename || markdownName
  };
};
