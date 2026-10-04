/*
 * 通用网页分支的进度上报（MAIN world）。
 *
 * 与飞书分支的 toast-bridge.js 不同：这里没有上游 Toast 可以桥接，
 * 进度/终态由本模块直接产出，但走的是同一套 window.postMessage 协议，
 * 因此悬浮 UI（src/feishu/content/index.js）不需要区分分支。
 */
import { FEISHU_EVENT, POST_MESSAGE_FLAG } from '../../feishu/protocol.js';

/*
 * 图片下载进度必须用 'image' 作 key：悬浮 UI 只认 AGGREGATE_PROGRESS_KEYS（image / file），
 * 其它 key 的百分比不会进圆环（与飞书分支上游 Toast 的 TranslationKey.IMAGE 同源）。
 */
export const IMAGE_PROGRESS_KEY = 'image';

/*
 * 清单前的体积探测进度：故意不用 'image' —— 它不是下载百分比，
 * 进了圆环聚合会让进度环在清单出现前先乱跳。
 */
export const PROBE_PROGRESS_KEY = 'probe';

const post = (event, payload) => {
  window.postMessage({ [POST_MESSAGE_FLAG]: true, event, ...payload }, '*');
};

/**
 * 进度条目，结构与飞书分支 toast-bridge.js 产出的 ProgressEntry 一致：
 *   { key, content, level, percent? }
 * percent 缺省表示该阶段没有真实百分比，悬浮 UI 的圆环走不确定态。
 */
export function entry(key, content, { level = 'loading', percent } = {}) {
  const item = { key, content, level };

  if (typeof percent === 'number') {
    item.percent = percent;
  }

  return item;
}

export function postProgress(entries) {
  post(FEISHU_EVENT.PROGRESS, { entries });
}

export function postDone(message, entries) {
  post(FEISHU_EVENT.DONE, { entries, message });
}

export function postFailed(message, entries) {
  post(FEISHU_EVENT.FAILED, { entries, message });
}
