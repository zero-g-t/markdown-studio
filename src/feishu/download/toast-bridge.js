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

/*
 * [临时诊断] 定位飞书「undefined」失败。全部走 console.error：
 * 用户 Console 的层级过滤会挡掉 console.log（上一轮诊断因此一条都没显示出来）。
 */
function diag(level, options) {
  const content = options?.content;

  console.error(
    '[md-studio][diag] toast',
    level,
    '| key =',
    options?.key ?? '(default)',
    '| typeof content =',
    typeof content,
    '| content =',
    content === undefined ? '<undefined>' : String(content)
  );
}

/*
 * [临时诊断] 面包屑：既打 console.error，也写进面板条目（面板最终会带着完整轨迹一起显示，
 * 截图就能看见走到哪一步）。写入器由 installProgressToast 安装。
 */
let diagWriter = null;
let diagSeq = 0;

export function diagStep(...parts) {
  // 调用点自带 '[md-studio][diag] step ' 前缀，这里剥掉一次，避免日志出现双前缀
  const name = parts.map((part) => String(part)).join(' ').replace(/^\[md-studio\]\[diag\] step\s*/, '');

  console.error('[md-studio][diag] step', name);

  diagSeq += 1;
  diagWriter?.(`diag:${String(diagSeq)}`, `diag step ${name}`);
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

  // [临时诊断] 面包屑落进面板条目，且不会被 finish 清掉
  diagWriter = (key, content) => {
    write(key, content, 'info');
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
      diag('loading', { content, key });
      write(key, content, 'loading');
    },
    success: ({ content, key = DEFAULT_KEY }) => {
      diag('success', { content, key });
      // 单张图片/附件失败时上游也会调 Toast.error，但只有最终成功才会走 Toast.success，
      // 因此 success 出现即判定整条链路成功。
      succeeded = true;
      successContent = content;
      write(key, content, 'success');
    },
    warning: ({ content, key = DEFAULT_KEY }) => {
      diag('warning', { content, key });
      failure = { content, level: 'warning' };
      write(key, content, 'warning');
    },
    error: ({ content, key = DEFAULT_KEY }) => {
      diag('error', { content, key });
      failure = { content, level: 'error' };
      write(key, content, 'error');
    },
    info: ({ content, key = DEFAULT_KEY }) => {
      diag('info', { content, key });
      write(key, content, 'info');
    },
    remove: (key) => {
      console.error('[md-studio][diag] toast remove | key =', key);
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

// [临时诊断] 加载标记：确认页面跑的是带面包屑的这一版 bundle（陈旧产物会缺这一行）
console.error('[md-studio][diag] bundle 已加载：feishu-download v3（带面包屑 + 面板轨迹）');
