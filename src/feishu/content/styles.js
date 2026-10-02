// 悬浮 UI 的几何与样式。全部内联进 Shadow DOM，与飞书页面样式彻底隔离。
export const HOST_ID = 'markdown-studio-feishu-host';

export const BUTTON_SIZE = 36;

// 圆环几何：viewBox 36×36、r = 15、stroke-width = 3
export const RING_RADIUS = 15;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// 不确定态（上游不报百分比时）显示的弧长：整圈的 1/4
export const RING_INDETERMINATE_LENGTH = RING_CIRCUMFERENCE / 4;

export const ICON_DOWNLOAD = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"></path>
  <path d="M7.25 7.689V2a.75.75 0 0 1 1.5 0v5.689l1.97-1.969a.749.749 0 1 1 1.06 1.06l-3.25 3.25a.749.749 0 0 1-1.06 0L4.22 6.78a.749.749 0 1 1 1.06-1.06l1.97 1.969Z"></path>
</svg>`;

export const ICON_DONE = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path>
</svg>`;

export const ICON_FAILED = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"></path>
</svg>`;

export const ICON_MANIFEST = `<svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
  <path d="M2 4.75A.75.75 0 0 1 2.75 4h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm0 4A.75.75 0 0 1 2.75 8h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 8.75Zm0 4A.75.75 0 0 1 2.75 12h7.5a.75.75 0 0 1 0 1.5h-7.5A.75.75 0 0 1 2 12.75Z"></path>
</svg>`;

export const FLOATING_UI_MARKUP = `
<div class="panel" hidden>
  <div class="panel-head">
    <span class="panel-title">文档 → Markdown</span>
    <button class="panel-close" type="button" aria-label="收起">×</button>
  </div>
  <ul class="panel-list"></ul>
  <div class="panel-hint"></div>
  <div class="manifest" hidden>
    <div class="manifest-groups"></div>
    <div class="manifest-foot">
      <span class="manifest-count"></span>
      <button class="panel-action manifest-start" type="button">开始下载</button>
      <button class="panel-action ghost manifest-cancel" type="button">取消</button>
    </div>
  </div>
  <div class="panel-foot">
    <span class="panel-status"></span>
    <button class="panel-action panel-redownload" type="button" hidden>重新下载</button>
  </div>
</div>
<button class="button" type="button" aria-label="转换为 Markdown 并下载" title="转换为 Markdown 并下载">
  <span class="glyph" data-glyph="download">${ICON_DOWNLOAD}</span>
  <span class="glyph" data-glyph="ring" hidden>
    <svg class="ring" viewBox="0 0 36 36" width="34" height="34" aria-hidden="true">
      <circle class="ring-track" cx="18" cy="18" r="${RING_RADIUS}"></circle>
      <circle class="ring-value" cx="18" cy="18" r="${RING_RADIUS}"
        stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${RING_CIRCUMFERENCE}"></circle>
    </svg>
    <span class="ring-label"></span>
  </span>
  <span class="glyph" data-glyph="done" hidden>${ICON_DONE}</span>
  <span class="glyph" data-glyph="failed" hidden>${ICON_FAILED}</span>
  <span class="glyph" data-glyph="manifest" hidden>${ICON_MANIFEST}</span>
</button>
`;

export const FLOATING_UI_STYLES = `
:host {
  all: initial;
}

:host {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 12px;
  line-height: 1.5;
  color: #24292f;
}

.glyph[hidden],
.panel[hidden],
.panel-action[hidden],
.panel-list[hidden],
.panel-hint[hidden],
.panel-foot[hidden],
.manifest[hidden] {
  display: none;
}

.button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${BUTTON_SIZE}px;
  height: ${BUTTON_SIZE}px;
  padding: 0;
  border: 1px solid var(--md-accent);
  border-radius: 50%;
  background: #ffffff;
  color: var(--md-accent);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.16);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.button:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.22);
  background: var(--md-soft);
}

.button:focus-visible {
  outline: 2px solid var(--md-strong);
  outline-offset: 2px;
}

.glyph {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.ring {
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: var(--md-soft);
  stroke-width: 3;
}

.ring-value {
  fill: none;
  stroke: var(--md-accent);
  stroke-width: 3;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.2s linear;
}

.button.indeterminate .ring {
  animation: md-studio-ring-spin 1.1s linear infinite;
}

.button.indeterminate .ring-value {
  stroke-dasharray: ${RING_INDETERMINATE_LENGTH};
  stroke-dashoffset: 0;
}

.ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: -0.2px;
  color: var(--md-strong);
}

@keyframes md-studio-ring-spin {
  from { transform: rotate(-90deg); }
  to { transform: rotate(270deg); }
}

.panel {
  position: absolute;
  right: 0;
  bottom: ${BUTTON_SIZE + 8}px;
  display: flex;
  flex-direction: column;
  width: 300px;
  max-height: 340px;
  overflow: hidden;
  border: 1px solid var(--md-border);
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px 9px 12px;
  border-bottom: 1px solid var(--md-border);
  background: var(--md-soft);
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--md-strong);
}

.panel-close {
  padding: 0 5px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--md-accent);
  font-size: 16px;
  line-height: 1.2;
  cursor: pointer;
}

.panel-close:hover {
  background: #ffffff;
}

.panel-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 6px 0;
  overflow-y: auto;
  list-style: none;
}

.panel-item {
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 8px;
  align-items: start;
  padding: 5px 12px;
}

.panel-item .dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--md-accent);
}

.panel-item[data-level='success'] .dot {
  background: #2ea043;
}

.panel-item[data-level='warning'] .dot,
.panel-item[data-level='error'] .dot {
  background: #d1242f;
}

.panel-item .text {
  word-break: break-all;
}

.panel-item .bar {
  grid-column: 2;
  height: 3px;
  margin-top: 5px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--md-soft);
}

.panel-item .bar i {
  display: block;
  height: 100%;
  background: var(--md-accent);
}

.panel-hint {
  padding: 12px;
  color: #57606a;
}

.panel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--md-border);
  color: #57606a;
}

.panel-action {
  padding: 3px 10px;
  border: 1px solid var(--md-accent);
  border-radius: 8px;
  background: transparent;
  color: var(--md-accent);
  font-size: 12px;
  cursor: pointer;
}

.panel-action:hover {
  background: var(--md-soft);
}

.panel-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.panel-action.ghost {
  border-color: var(--md-border);
  color: #57606a;
}

/* ---- 下载清单模式 ---- */

.panel.manifest-mode {
  width: 340px;
  max-height: min(72vh, 460px);
}

.manifest {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.manifest-groups {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.manifest-group + .manifest-group {
  border-top: 1px solid var(--md-border);
}

.manifest-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  background: var(--md-soft);
  color: var(--md-strong);
  font-weight: 600;
  cursor: pointer;
}

.manifest-group-count {
  margin-left: auto;
  color: #57606a;
  font-weight: 400;
}

.manifest-items {
  margin: 0;
  padding: 2px 0 6px;
  list-style: none;
}

.manifest-item {
  padding: 4px 12px;
}

.manifest-item-label {
  display: grid;
  grid-template-columns: 14px 1fr auto;
  gap: 6px;
  align-items: start;
  cursor: pointer;
}

.manifest-name {
  word-break: break-all;
}

.manifest-size {
  color: #57606a;
  white-space: nowrap;
}

.manifest-size.is-large {
  color: #d1242f;
  font-weight: 600;
}

.manifest-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid var(--md-border);
}

.manifest-count {
  margin-right: auto;
  color: #57606a;
}

input[type='checkbox'] {
  width: 14px;
  height: 14px;
  margin: 2px 0 0;
  accent-color: var(--md-accent);
}
`;
