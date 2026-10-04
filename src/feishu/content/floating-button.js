import {
  FLOATING_UI_MARKUP,
  FLOATING_UI_STYLES,
  HOST_ID,
  RING_CIRCUMFERENCE
} from './styles.js';

export const BUTTON_PHASE = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  SELECTING: 'selecting',
  DOWNLOADING: 'downloading',
  DONE: 'done',
  FAILED: 'failed'
};

const PHASE_GLYPH = {
  [BUTTON_PHASE.IDLE]: 'download',
  [BUTTON_PHASE.SCANNING]: 'ring',
  [BUTTON_PHASE.SELECTING]: 'manifest',
  [BUTTON_PHASE.DOWNLOADING]: 'ring',
  [BUTTON_PHASE.DONE]: 'done',
  [BUTTON_PHASE.FAILED]: 'failed'
};

const PHASE_LABEL = {
  [BUTTON_PHASE.IDLE]: '转换为 Markdown 并下载',
  [BUTTON_PHASE.SCANNING]: '正在扫描文档',
  [BUTTON_PHASE.SELECTING]: '选择要下载的内容',
  [BUTTON_PHASE.DOWNLOADING]: '正在转换为 Markdown',
  [BUTTON_PHASE.DONE]: '转换完成',
  [BUTTON_PHASE.FAILED]: '转换失败'
};

const PHASE_STATUS = {
  [BUTTON_PHASE.SCANNING]: '扫描中',
  [BUTTON_PHASE.SELECTING]: '等待勾选',
  [BUTTON_PHASE.DOWNLOADING]: '下载中',
  [BUTTON_PHASE.DONE]: '下载完成',
  [BUTTON_PHASE.FAILED]: '下载失败'
};

const PREPARING_HINT = '正在准备文档…';
const SCANNING_HINT = '正在扫描文档…';

// 附件体积超过该阈值时在清单里高亮，避免再被超大文件坑一次
const LARGE_FILE_BYTES = 50 * 1024 * 1024;

const GROUP_ORDER = ['image', 'diagram', 'file'];
const GROUP_LABEL = {
  image: '图片',
  diagram: '画板与图表',
  file: '附件'
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function clampPercent(percent) {
  return Math.max(0, Math.min(100, Number(percent)));
}

function formatSize(size) {
  if (typeof size !== 'number' || size <= 0) {
    return '大小未知';
  }
  if (size >= 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function renderManifestGroup(group, items, selected) {
  if (!items.length) {
    return '';
  }

  const selectedCount = items.filter((item) => selected.has(item.id)).length;
  const headChecked = selectedCount === items.length ? ' checked' : '';
  const headPartial = selectedCount > 0 && selectedCount < items.length ? ' data-indeterminate="1"' : '';

  const rows = items
    .map((item) => {
      const isLarge = item.group === 'file' && typeof item.size === 'number' && item.size >= LARGE_FILE_BYTES;
      // 每一类（图片 / 画板与图表 / 附件）都显示大小；探测不到时如实写「大小未知」
      const sizeCell = `<span class="manifest-size${isLarge ? ' is-large' : ''}">${formatSize(item.size)}</span>`;

      return `<li class="manifest-item">
        <label class="manifest-item-label">
          <input type="checkbox" data-item-id="${escapeHtml(item.id)}"${selected.has(item.id) ? ' checked' : ''}>
          <span class="manifest-name">${escapeHtml(item.name)}</span>
          ${sizeCell}
        </label>
      </li>`;
    })
    .join('');

  return `<section class="manifest-group" data-group="${escapeHtml(group)}">
    <label class="manifest-group-head">
      <input type="checkbox" data-group-toggle="${escapeHtml(group)}"${headChecked}${headPartial}>
      <span>${escapeHtml(GROUP_LABEL[group] || group)}</span>
      <span class="manifest-group-count">${selectedCount}/${items.length} 项</span>
    </label>
    <ul class="manifest-items">${rows}</ul>
  </section>`;
}

/**
 * 右下角悬浮按钮：圆形进度环 + 状态面板 + 下载清单。
 * 组件本身不持有业务状态，只按传入的视图模型渲染，并把交互回抛给调用方。
 */
export class FloatingButton {
  constructor({
    onButtonClick,
    onClosePanel,
    onRedownload,
    onToggleItem,
    onToggleGroup,
    onStartDownload,
    onCancelSelection
  }) {
    this.onButtonClick = onButtonClick;
    this.onClosePanel = onClosePanel;
    this.onRedownload = onRedownload;
    this.onToggleItem = onToggleItem;
    this.onToggleGroup = onToggleGroup;
    this.onStartDownload = onStartDownload;
    this.onCancelSelection = onCancelSelection;
    this.host = null;
    this.shadow = null;
    this.parts = null;
    // 清单列表的签名：内容没变就不重建 DOM，避免进度事件重绘时重置勾选与滚动位置
    this.manifestSignature = '';
  }

  mount() {
    if (this.host) {
      return;
    }

    const host = document.createElement('div');
    host.id = HOST_ID;
    // 宿主自身不接收任何页面样式：all: initial 打底，再钉在右下角。
    host.style.cssText = [
      'all: initial',
      'position: fixed',
      'right: 20px',
      'bottom: 20px',
      'z-index: 2147483647'
    ].join('; ');

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${FLOATING_UI_STYLES}</style>${FLOATING_UI_MARKUP}`;

    this.parts = {
      button: shadow.querySelector('.button'),
      panel: shadow.querySelector('.panel'),
      close: shadow.querySelector('.panel-close'),
      list: shadow.querySelector('.panel-list'),
      hint: shadow.querySelector('.panel-hint'),
      status: shadow.querySelector('.panel-status'),
      foot: shadow.querySelector('.panel-foot'),
      redownload: shadow.querySelector('.panel-redownload'),
      manifest: shadow.querySelector('.manifest'),
      manifestGroups: shadow.querySelector('.manifest-groups'),
      manifestCount: shadow.querySelector('.manifest-count'),
      start: shadow.querySelector('.manifest-start'),
      cancel: shadow.querySelector('.manifest-cancel'),
      ringValue: shadow.querySelector('.ring-value'),
      ringLabel: shadow.querySelector('.ring-label'),
      glyphs: Array.from(shadow.querySelectorAll('.glyph')).reduce((map, node) => {
        map[node.dataset.glyph] = node;
        return map;
      }, {})
    };

    this.parts.button.addEventListener('click', () => this.onButtonClick?.());
    this.parts.close.addEventListener('click', () => this.onClosePanel?.());
    this.parts.redownload.addEventListener('click', () => this.onRedownload?.());
    this.parts.start.addEventListener('click', () => this.onStartDownload?.());
    this.parts.cancel.addEventListener('click', () => this.onCancelSelection?.());
    this.parts.manifestGroups.addEventListener('change', (event) => this.handleManifestChange(event));

    document.body.appendChild(host);
    this.host = host;
    this.shadow = shadow;
  }

  handleManifestChange(event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const { itemId, groupToggle } = input.dataset;

    if (itemId) {
      this.onToggleItem?.(itemId, input.checked);
      return;
    }

    if (groupToggle) {
      this.onToggleGroup?.(groupToggle, input.checked);
    }
  }

  unmount() {
    this.host?.remove();
    this.host = null;
    this.shadow = null;
    this.parts = null;
    this.manifestSignature = '';
  }

  setTheme(theme) {
    if (!this.host) {
      return;
    }
    this.host.style.setProperty('--md-accent', theme.accent);
    this.host.style.setProperty('--md-strong', theme.strong);
    this.host.style.setProperty('--md-soft', theme.soft);
    this.host.style.setProperty('--md-border', theme.soft);
  }

  /**
   * @param {{
   *   phase: 'idle' | 'scanning' | 'selecting' | 'downloading' | 'done' | 'failed',
   *   percent: number | null,   // null = 上游未报百分比，圆环走不确定态
   *   entries: Array<{ key: string, content: string, level: string, percent?: number }>,
   *   message: string,
   *   panelOpen: boolean,
   *   manifest: Array<{ id: string, group: string, name: string, size: number | null }>,
   *   selected: Set<string>
   * }} view
   */
  render(view) {
    if (!this.host) {
      return;
    }

    this.renderButton(view.phase, view.percent);
    this.renderPanel(view);
  }

  renderButton(phase, percent) {
    const { button, glyphs, ringValue, ringLabel } = this.parts;
    const glyphName = PHASE_GLYPH[phase] || PHASE_GLYPH[BUTTON_PHASE.IDLE];

    Object.entries(glyphs).forEach(([name, node]) => {
      node.hidden = name !== glyphName;
    });

    const indeterminate =
      (phase === BUTTON_PHASE.SCANNING || phase === BUTTON_PHASE.DOWNLOADING) && percent === null;
    button.classList.toggle('indeterminate', indeterminate);

    if (phase === BUTTON_PHASE.DOWNLOADING && !indeterminate) {
      const progress = clampPercent(percent);
      ringValue.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - progress / 100));
      ringLabel.textContent = `${Math.round(progress)}%`;
    } else {
      ringValue.style.strokeDashoffset = '';
      ringLabel.textContent = '';
    }

    button.title = PHASE_LABEL[phase] || PHASE_LABEL[BUTTON_PHASE.IDLE];
    button.setAttribute('aria-label', button.title);
  }

  renderPanel({ phase, percent, entries, message, panelOpen, manifest, selected }) {
    const { panel, list, hint, status, foot, manifest: manifestEl } = this.parts;
    const items = Array.isArray(manifest) ? manifest : [];
    const inManifestMode = items.length > 0;

    panel.hidden = !panelOpen;
    panel.classList.toggle('manifest-mode', inManifestMode);

    if (inManifestMode) {
      list.hidden = true;
      hint.hidden = true;
      foot.hidden = true;
      manifestEl.hidden = false;
      this.renderManifest(items, selected instanceof Set ? selected : new Set());
      status.textContent = PHASE_STATUS[phase] || '';
      return;
    }

    this.manifestSignature = '';
    manifestEl.hidden = true;
    foot.hidden = false;

    const rows = Array.isArray(entries) ? entries : [];

    if (rows.length > 0) {
      list.hidden = false;
      hint.hidden = true;
      list.innerHTML = rows.map(renderEntry).join('');
    } else {
      list.hidden = true;
      list.innerHTML = '';
      hint.hidden = false;
      hint.textContent = message
        || (phase === BUTTON_PHASE.SCANNING ? SCANNING_HINT : '')
        || (phase === BUTTON_PHASE.DOWNLOADING ? PREPARING_HINT : '');
    }

    if (phase === BUTTON_PHASE.DOWNLOADING) {
      status.textContent = percent === null
        ? PHASE_STATUS[phase]
        : `${PHASE_STATUS[phase]} ${Math.round(clampPercent(percent))}%`;
    } else {
      status.textContent = PHASE_STATUS[phase] || '';
    }

    this.parts.redownload.hidden = phase !== BUTTON_PHASE.DONE && phase !== BUTTON_PHASE.FAILED;
  }

  renderManifest(items, selected) {
    const { manifestGroups, manifestCount, start } = this.parts;
    const selectedCount = items.filter((item) => selected.has(item.id)).length;

    manifestCount.textContent = `已选 ${selectedCount}/${items.length}`;
    start.disabled = selectedCount === 0;

    // 签名里带上 size：清单报出来后若体积探测结果才补上，也要重建一次 DOM
    const signature = items
      .map((item) => `${item.id}:${item.size ?? ''}:${selected.has(item.id) ? 1 : 0}`)
      .join('|');
    if (signature === this.manifestSignature) {
      return;
    }
    this.manifestSignature = signature;

    manifestGroups.innerHTML = GROUP_ORDER
      .map((group) => renderManifestGroup(group, items.filter((item) => item.group === group), selected))
      .filter(Boolean)
      .join('');

    // 组内部分勾选时把组头复选框显示成半选态
    manifestGroups.querySelectorAll('input[data-indeterminate="1"]').forEach((node) => {
      node.indeterminate = true;
    });
  }
}

function renderEntry(entry) {
  const bar = typeof entry.percent === 'number'
    ? `<span class="bar"><i style="width:${clampPercent(entry.percent)}%"></i></span>`
    : '';

  return `<li class="panel-item" data-level="${escapeHtml(entry.level)}">
    <span class="dot"></span>
    <span class="text">${escapeHtml(entry.content)}</span>
    ${bar}
  </li>`;
}
