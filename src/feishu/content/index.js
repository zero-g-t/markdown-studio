/*
 * 内容脚本入口（ISOLATED world）。
 *
 * 职责：
 *   1. 判断当前页面是否由某个站点适配器接管（飞书文档页 / 其它 http/https 网页）；
 *      —— 本文件与具体站点无关，两个适配器共用同一份实现；
 *   2. 挂载右下角悬浮按钮 + 圆形进度环 + 状态面板（含下载清单），并跟随 markdown-studio 的主题色；
 *   3. 点击时请求 Service Worker 向 MAIN world 注入转换器；
 *   4. 接收 MAIN world 上报的清单 / 进度 / 结果，回传用户勾选；驱动 UI。
 *
 * 阶段流转：
 *   idle → scanning（提取待下载清单）→ selecting（等用户勾选）→ downloading → done / failed
 */
import { FloatingButton, BUTTON_PHASE } from './floating-button.js';
import { resolveProvider } from '../site-providers.js';
import {
  AGGREGATE_PROGRESS_KEYS,
  FEISHU_EVENT,
  POST_MESSAGE_FLAG,
  RUNTIME_MESSAGE_FETCH_IMAGE,
  RUNTIME_MESSAGE_OPEN_CLIP,
  RUNTIME_MESSAGE_SAVE_CLIP_FILE,
  RUNTIME_MESSAGE_SITE_DOWNLOAD
} from '../protocol.js';
import { DEFAULT_THEME_COLOR, resolveThemeColor } from '../../shared/theme-colors.js';

// 与 src/main.js 中 PreferenceStore 的 themeColor 同键，保证两处主题色同源
const THEME_STORAGE_KEY = 'themeColor';

class ProviderController {
  constructor(provider) {
    this.provider = provider;
    this.button = new FloatingButton({
      onButtonClick: () => this.handleButtonClick(),
      onClosePanel: () => {
        this.panelOpen = false;
        this.render();
      },
      onRedownload: () => this.startFlow(),
      onToggleItem: (id, checked) => this.toggleItem(id, checked),
      onToggleGroup: (group, checked) => this.toggleGroup(group, checked),
      onStartDownload: () => this.confirmSelection(),
      onCancelSelection: () => this.cancelSelection()
    });

    this.phase = BUTTON_PHASE.IDLE;
    this.percent = null;
    this.entries = [];
    this.message = '';
    this.panelOpen = false;
    // 本次运行的聚合进度 key → 最后已知百分比。
    // 上游在某一组下载完成时会 Toast.remove 掉该条目，保留最后值可避免圆环凭空退回不确定态。
    this.groupPercents = new Map();
    // 待下载清单与勾选结果
    this.manifest = [];
    this.selected = new Set();
    // 是否处于「一次有效运行」中：用户取消后，MAIN 侧迟到的终态事件必须被忽略
    this.activeRun = false;
    // 本轮运行是否已由用户点过「开始下载」：跨域代抓只认这一个窗口（见 relayImageFetch）
    this.selectionConfirmed = false;
    this.handleWindowMessage = (event) => this.receiveMessage(event);
    this.handleStorageChanged = (changes, areaName) => this.applyStorageTheme(changes, areaName);
  }

  async mount() {
    if (!document.body) {
      return;
    }

    this.button.mount();
    this.button.setTheme(resolveThemeColor(DEFAULT_THEME_COLOR));
    window.addEventListener('message', this.handleWindowMessage);
    chrome.storage?.onChanged?.addListener(this.handleStorageChanged);
    this.render();
    await this.loadTheme();
  }

  unmount() {
    window.removeEventListener('message', this.handleWindowMessage);
    chrome.storage?.onChanged?.removeListener(this.handleStorageChanged);
    this.button.unmount();
  }

  async loadTheme() {
    try {
      const stored = await chrome.storage.local.get({ [THEME_STORAGE_KEY]: DEFAULT_THEME_COLOR });
      this.button.setTheme(resolveThemeColor(stored[THEME_STORAGE_KEY]));
    } catch (error) {
      console.warn('[markdown-studio] 读取主题色失败，回退默认主题色', error);
    }
  }

  applyStorageTheme(changes, areaName) {
    if (areaName !== 'local' || !changes[THEME_STORAGE_KEY]) {
      return;
    }
    this.button.setTheme(resolveThemeColor(changes[THEME_STORAGE_KEY].newValue));
  }

  handleButtonClick() {
    // 空闲态：开始扫描；其余阶段（扫描/勾选/下载/已结束）：展开或收起面板
    if (this.phase === BUTTON_PHASE.IDLE) {
      this.startFlow();
      return;
    }
    this.panelOpen = !this.panelOpen;
    this.render();
  }

  startFlow() {
    if (this.activeRun) {
      return;
    }

    this.activeRun = true;
    this.selectionConfirmed = false;
    this.phase = BUTTON_PHASE.SCANNING;
    this.percent = null;
    this.entries = [];
    this.groupPercents.clear();
    this.manifest = [];
    this.selected = new Set();
    this.message = '';
    this.panelOpen = false;
    this.render();

    chrome.runtime
      .sendMessage({
        type: RUNTIME_MESSAGE_SITE_DOWNLOAD,
        providerId: this.provider.id,
        bundle: this.provider.bundle
      })
      .then((response) => {
        if (response?.ok) {
          return;
        }
        this.fail(response?.error || '无法启动下载');
      })
      .catch((error) => {
        this.fail(error?.message || '无法启动下载');
      });
  }

  fail(message) {
    this.activeRun = false;
    this.phase = BUTTON_PHASE.FAILED;
    this.message = message;
    this.render();
  }

  /** 用户在清单里点「开始下载」 */
  confirmSelection() {
    if (this.phase !== BUTTON_PHASE.SELECTING || this.selected.size === 0) {
      return;
    }

    this.phase = BUTTON_PHASE.DOWNLOADING;
    this.selectionConfirmed = true;
    this.percent = null;
    this.entries = [];
    this.groupPercents.clear();
    this.manifest = [];
    this.message = '';
    this.panelOpen = true;
    this.render();

    this.postSelection({ selectedIds: Array.from(this.selected) });
  }

  /** 用户点「取消」：MAIN 侧会收到 cancelled 并走上游的中止路径 */
  cancelSelection() {
    if (this.phase !== BUTTON_PHASE.SELECTING) {
      return;
    }

    this.activeRun = false;
    this.selectionConfirmed = false;
    this.phase = BUTTON_PHASE.IDLE;
    this.manifest = [];
    this.selected = new Set();
    this.message = '';
    this.panelOpen = false;
    this.render();

    this.postSelection({ cancelled: true });
  }

  postSelection(payload) {
    window.postMessage({ [POST_MESSAGE_FLAG]: true, event: FEISHU_EVENT.SELECTION, ...payload }, '*');
  }

  toggleItem(id, checked) {
    if (this.phase !== BUTTON_PHASE.SELECTING) {
      return;
    }

    if (checked) {
      this.selected.add(id);
    } else {
      this.selected.delete(id);
    }
    this.render();
  }

  toggleGroup(group, checked) {
    if (this.phase !== BUTTON_PHASE.SELECTING) {
      return;
    }

    this.manifest
      .filter((item) => item.group === group)
      .forEach((item) => {
        if (checked) {
          this.selected.add(item.id);
        } else {
          this.selected.delete(item.id);
        }
      });
    this.render();
  }

  receiveMessage(event) {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data[POST_MESSAGE_FLAG] !== true) {
      return;
    }

    switch (data.event) {
      case FEISHU_EVENT.PROGRESS:
        this.applyEntries(data.entries);
        // 有些适配器不保证会上报清单（通用网页分支在正文没有图片时不会进 SELECTING），
        // 收到第一条进度就离开「扫描中」，否则会一直停在扫描文案上。
        if (this.provider.skipManifestPhase && this.phase === BUTTON_PHASE.SCANNING) {
          this.phase = BUTTON_PHASE.DOWNLOADING;
        }
        this.render();
        break;
      case FEISHU_EVENT.MANIFEST:
        this.applyManifest(data.items);
        break;
      case FEISHU_EVENT.FETCH_IMAGE:
        this.relayImageFetch(data);
        break;
      case FEISHU_EVENT.SAVE:
      case FEISHU_EVENT.SAVE_FINISH:
        this.relaySave(data);
        break;
      case FEISHU_EVENT.DONE:
        if (!this.activeRun) {
          return;
        }
        this.applyEntries(data.entries);
        this.activeRun = false;
        this.phase = BUTTON_PHASE.DONE;
        this.message = data.message || '下载完成';
        this.render();
        break;
      case FEISHU_EVENT.FAILED:
        if (!this.activeRun) {
          return;
        }
        this.applyEntries(data.entries);
        this.fail(data.message || '下载失败');
        break;
      default:
        break;
    }
  }

  /*
   * 跨域图片代抓中继：MAIN world 的 fetch 读不到没有 CORS 头的跨域响应体，
   * 由这里转给 Service Worker（扩展权限不受页面同源策略限制）。
   * 一次请求只转一次，不重试：失败原因原样回传，由 MAIN 侧如实上报。
   *
   * 收口：MAIN world 与页面同源，postMessage 无法区分「转换器发的」与「页面伪造的」，
   * 所以只认「本轮运行 + 用户点过开始下载 + 正处于下载阶段」这一个窗口。
   * 正常流程里图片下载恰好只发生在这一窗口内（有图必先经清单勾选），因此不改变任何合法行为；
   * 窗口之外一律拒绝，避免把扩展当成任意 URL 的带凭据代理。
   */
  relayImageFetch({ requestId, url }) {
    const reply = (payload) => {
      window.postMessage(
        {
          [POST_MESSAGE_FLAG]: true,
          event: FEISHU_EVENT.FETCH_IMAGE_RESULT,
          requestId,
          ...payload
        },
        '*'
      );
    };

    if (!this.activeRun || !this.selectionConfirmed || this.phase !== BUTTON_PHASE.DOWNLOADING) {
      reply({ ok: false, error: '当前不在图片下载流程中，已拒绝代抓' });
      return;
    }

    chrome.runtime
      .sendMessage({ type: RUNTIME_MESSAGE_FETCH_IMAGE, url })
      .then((response) => {
        if (response?.ok) {
          reply({ ok: true, base64: response.base64, contentType: response.contentType });
          return;
        }

        reply({ ok: false, error: response?.error || '扩展抓取失败' });
      })
      .catch((error) => {
        reply({ ok: false, error: error?.message || String(error) });
      });
  }

  /*
   * 落盘中继：MAIN world 没有 chrome.*，「在下载目录下建 <标题>/ 子文件夹」只能由
   * Service Worker 用 chrome.downloads 完成，字节（base64）经这里转发。
   *
   * 收口与跨域代抓同一思路：只认「本轮运行」这一个窗口 —— postMessage 区分不了
   * 「转换器发的」与「页面伪造的」，窗口之外一律拒绝，避免把扩展当成任意写盘工具。
   */
  relaySave({ event, requestId, folder, path, mime, base64, downloadId }) {
    const reply = (result) => {
      window.postMessage(
        { [POST_MESSAGE_FLAG]: true, event: FEISHU_EVENT.SAVE_RESULT, requestId, ...result },
        '*'
      );
    };

    if (!this.activeRun) {
      reply({ ok: false, error: '当前不在下载流程中，已拒绝写入本地文件' });
      return;
    }

    const message =
      event === FEISHU_EVENT.SAVE_FINISH
        ? { type: RUNTIME_MESSAGE_OPEN_CLIP, folder, path, downloadId }
        : { type: RUNTIME_MESSAGE_SAVE_CLIP_FILE, folder, path, mime, base64 };

    chrome.runtime
      .sendMessage(message)
      .then((response) => {
        if (response?.ok) {
          reply({ ok: true, filename: response.filename, downloadId: response.downloadId });
          return;
        }

        reply({ ok: false, error: response?.error || '写入本地文件失败' });
      })
      .catch((error) => {
        reply({ ok: false, error: error?.message || String(error) });
      });
  }

  applyManifest(items) {
    if (!this.activeRun) {
      return;
    }

    this.manifest = Array.isArray(items) ? items : [];
    this.selected = new Set(this.manifest.map((item) => item.id));
    this.phase = BUTTON_PHASE.SELECTING;
    // 清单必须直接展开：不展开用户无从勾选
    this.panelOpen = true;
    this.render();
  }

  applyEntries(entries) {
    this.entries = Array.isArray(entries) ? entries : [];

    this.entries.forEach((entry) => {
      if (AGGREGATE_PROGRESS_KEYS.includes(entry.key) && typeof entry.percent === 'number') {
        this.groupPercents.set(entry.key, entry.percent);
      }
    });

    this.percent = this.computePercent();
  }

  // 圆环只用上游真实上报的百分比：图片组与附件组各报一个，取平均。
  // 上游不报百分比的阶段（滚动加载、解析 AST、打包 zip、等待勾选）返回 null，圆环走不确定态。
  computePercent() {
    if (this.groupPercents.size === 0) {
      return null;
    }
    const values = Array.from(this.groupPercents.values());
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  render() {
    this.button.render({
      phase: this.phase,
      percent: this.percent,
      entries: this.entries,
      message: this.message,
      panelOpen: this.panelOpen,
      manifest: this.manifest,
      selected: this.selected
    });
  }
}

let controller = null;
let urlObserver = null;
let popstateHandler = null;
let lastHref = location.href;

function syncWithLocation() {
  const provider = resolveProvider(location.href);

  if (!provider) {
    controller?.unmount();
    controller = null;
    return;
  }

  if (controller?.provider === provider) {
    return;
  }

  controller?.unmount();
  controller = new ProviderController(provider);
  controller.mount().catch((error) => {
    console.error('[markdown-studio] 挂载悬浮按钮失败', error);
  });
}

function handleLocationChange() {
  if (location.href === lastHref) {
    return;
  }
  lastHref = location.href;
  syncWithLocation();
}

function start() {
  if (!document.body) {
    return;
  }

  syncWithLocation();

  // 飞书是 SPA，站内跳转不会重新执行内容脚本：沿用上游做法监听 body 子节点变化，
  // 另外补上浏览器前进/后退。
  urlObserver = new MutationObserver(handleLocationChange);
  urlObserver.observe(document.body, { childList: true });
  popstateHandler = handleLocationChange;
  window.addEventListener('popstate', popstateHandler);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
