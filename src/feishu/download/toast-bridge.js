/*
 * 上游 Toast → 进度事件的桥接（MAIN world）。
 *
 * 上游下载脚本（src/vendor/converter/scripts/download-lark-docx-as-markdown.ts）通过
 * `Toast.loading/success/warning/error/remove` 汇报进度与结果。默认情况下这个 Toast
 * 就是飞书页面自带的 `window.Toast`，会弹出「仍在保存中」「正在下载 xxx」等原生弹窗。
 *
 * 本文件把 `Toast` 换成自己的实现（见 src/vendor/lark/env.ts 的 setToast 适配缝），
 * 于是：
 *   · 上游下载脚本一行不改；
 *   · 所有提示变成 window.postMessage 进度事件，由悬浮 UI 渲染成进度环与状态面板；
 *   · 飞书原生弹窗不再出现。
 */
import { setToast } from '@dolphin/lark';
import { FEISHU_EVENT, POST_MESSAGE_FLAG } from '../protocol.js';

// 上游 ToastKey.DOWNLOADING：整个下载链路的「打包/保存中」占位条目。
// 上游在 main() 的 .finally 里移除它，这是全流程唯一且必然出现的终止信号。
const DOWNLOADING_KEY = 'downloading';

// 上游多数 Toast 调用不带 key，统一落到这个默认条目上
const DEFAULT_KEY = '__default__';

// 取最后一个 `xx%`：上游文案形如「下载 {{name}} 中：{{progress}}%（请不要刷新或关闭页面）」，
// 文件名本身也可能含 `%`，取最后一个才能拿到真正的进度值。
const PERCENT_PATTERN = /(\d+)\s*%/g;

function extractPercent(content) {
  let percent;
  PERCENT_PATTERN.lastIndex = 0;

  for (const matched of content.matchAll(PERCENT_PATTERN)) {
    percent = Number(matched[1]);
  }

  return percent;
}

function post(event, payload) {
  window.postMessage({ [POST_MESSAGE_FLAG]: true, event, ...payload }, '*');
}

export function installProgressToast() {
  const entries = new Map();
  let succeeded = false;
  let successContent = '';
  // 最后一条非 loading 的 warning / error，用于终止时给出失败原因
  let failure = null;

  const snapshot = () => Array.from(entries.values());
  const emitProgress = () => post(FEISHU_EVENT.PROGRESS, { entries: snapshot() });

  const write = (key, content, level) => {
    entries.set(key, { key, content, level, percent: extractPercent(content) });
    emitProgress();
  };

  const finish = () => {
    const finalEntries = snapshot();

    if (succeeded) {
      post(FEISHU_EVENT.DONE, { entries: finalEntries, message: successContent || '下载完成' });
      return;
    }

    post(FEISHU_EVENT.FAILED, {
      entries: finalEntries,
      message: failure?.content || '下载已中止'
    });
  };

  setToast({
    loading: ({ content, key = DEFAULT_KEY }) => {
      write(key, content, 'loading');
    },
    success: ({ content, key = DEFAULT_KEY }) => {
      // 单张图片/附件失败时上游也会调 Toast.error，但只有最终成功才会走 Toast.success，
      // 因此 success 出现即判定整条链路成功。
      succeeded = true;
      successContent = content;
      write(key, content, 'success');
    },
    warning: ({ content, key = DEFAULT_KEY }) => {
      failure = { content, level: 'warning' };
      write(key, content, 'warning');
    },
    error: ({ content, key = DEFAULT_KEY }) => {
      failure = { content, level: 'error' };
      write(key, content, 'error');
    },
    info: ({ content, key = DEFAULT_KEY }) => {
      write(key, content, 'info');
    },
    remove: (key) => {
      entries.delete(key);

      if (key === DOWNLOADING_KEY) {
        finish();
        return;
      }

      emitProgress();
    }
  });
}

installProgressToast();
