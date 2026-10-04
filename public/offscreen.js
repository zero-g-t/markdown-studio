/*
 * 离屏文档：把 Service Worker 传来的 base64 字节转成 blob URL。
 *
 * 为什么需要它：MV3 的 Service Worker 里没有 URL.createObjectURL，而 chrome.downloads 必须拿到
 * 一个 URL 才能落盘；data URL 又会撞上 URL 长度上限（Chrome 约 2MB），图片稍大就失败。
 * 于是由本文档创建 blob URL（与扩展同源），交给 background.js 去下载。
 *
 * 只做「建 URL」和「回收 URL」两件事，不直接调用扩展 API。
 */
const OFFSCREEN_TARGET = 'md-studio-offscreen';

const base64ToBytes = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== OFFSCREEN_TARGET) {
    return false;
  }

  if (message.type === 'CREATE_BLOB_URL') {
    try {
      const blob = new Blob([base64ToBytes(message.base64 || '')], {
        type: message.mime || 'application/octet-stream'
      });

      sendResponse({ ok: true, url: URL.createObjectURL(blob) });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }

    return false;
  }

  if (message.type === 'REVOKE_BLOB_URL') {
    URL.revokeObjectURL(message.url);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
