// 悬浮 UI 的几何与样式。全部内联进 Shadow DOM，与飞书页面样式彻底隔离。
export const HOST_ID = 'markdown-studio-feishu-host';

export const BUTTON_SIZE = 40;

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

/*
 * 苹果风格（macOS 系统 UI 观感）：
 *   · 字体走 SF Pro / 苹方，-webkit-font-smoothing 抗锯齿；
 *   · 字号层级明确：面板标题 15 > 分组头 13 = 列表项 13 > 辅助信息 12；
 *   · 界面主体中性白 + 细分隔线，主题色只用于强调（按钮 / 复选框 / 标题 / 进度）；
 *   · 面板半透明毛玻璃 + 大圆角 + 柔和多层阴影。
 */
export const FLOATING_UI_STYLES = `
:host {
  all: initial;
}

:host {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: #1d1d1f;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
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

/* ---- 右下角悬浮按钮 ---- */

.button {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: ${BUTTON_SIZE}px;
  height: ${BUTTON_SIZE}px;
  padding: 0;
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  backdrop-filter: saturate(180%) blur(20px);
  color: var(--md-accent);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.04),
    0 1px 2px rgba(0, 0, 0, 0.08),
    0 6px 20px rgba(0, 0, 0, 0.16);
  cursor: pointer;
  transition: transform 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s ease, background-color 0.18s ease;
}

.button:hover {
  transform: translateY(-1px) scale(1.03);
  background: #ffffff;
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.04),
    0 2px 4px rgba(0, 0, 0, 0.1),
    0 10px 28px rgba(0, 0, 0, 0.2);
}

.button:active {
  transform: scale(0.97);
}

.button:focus-visible {
  outline: 2px solid var(--md-accent);
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
  stroke: rgba(0, 0, 0, 0.08);
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
  font-size: 10px;
  font-weight: 700;
  letter-spacing: -0.3px;
  color: var(--md-strong);
}

@keyframes md-studio-ring-spin {
  from { transform: rotate(-90deg); }
  to { transform: rotate(270deg); }
}

/* ---- 面板 ---- */

.panel {
  position: absolute;
  right: 0;
  bottom: ${BUTTON_SIZE + 10}px;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-height: 360px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  -webkit-backdrop-filter: saturate(180%) blur(30px);
  backdrop-filter: saturate(180%) blur(30px);
  box-shadow:
    0 0 0 0.5px rgba(0, 0, 0, 0.04),
    0 10px 40px rgba(0, 0, 0, 0.18),
    0 2px 8px rgba(0, 0, 0, 0.06);
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 14px 12px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--md-strong);
}

.panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  color: #6e6e73;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.panel-close:hover {
  background: rgba(0, 0, 0, 0.1);
  color: #1d1d1f;
}

/* 进度条目（非清单模式） */
.panel-list {
  flex: 1;
  min-height: 0;
  margin: 0;
  padding: 8px 0;
  overflow-y: auto;
  list-style: none;
}

.panel-item {
  display: grid;
  grid-template-columns: 8px 1fr;
  gap: 10px;
  align-items: start;
  padding: 7px 16px;
}

.panel-item .dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--md-accent);
}

.panel-item[data-level='success'] .dot {
  background: #34c759;
}

.panel-item[data-level='warning'] .dot,
.panel-item[data-level='error'] .dot {
  background: #ff3b30;
}

.panel-item .text {
  word-break: break-all;
}

.panel-item .bar {
  grid-column: 2;
  height: 4px;
  margin-top: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
}

.panel-item .bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--md-accent);
  transition: width 0.2s linear;
}

.panel-hint {
  padding: 20px 16px;
  color: #86868b;
  font-size: 13px;
}

.panel-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 11px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  background: rgba(0, 0, 0, 0.02);
  color: #86868b;
  font-size: 12px;
}

/* ---- 按钮（苹果式：主按钮实心药丸，次按钮浅灰无边框） ---- */

.panel-action {
  padding: 6px 14px;
  border: 0;
  border-radius: 9px;
  background: var(--md-accent);
  color: #ffffff;
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: filter 0.15s ease, background-color 0.15s ease, transform 0.12s ease;
}

.panel-action:hover {
  filter: brightness(1.08);
}

.panel-action:active {
  transform: scale(0.97);
}

.panel-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  filter: none;
}

.panel-action.ghost {
  background: rgba(0, 0, 0, 0.05);
  color: #1d1d1f;
}

.panel-action.ghost:hover {
  background: rgba(0, 0, 0, 0.09);
  filter: none;
}

/* ---- 下载清单模式 ---- */

.panel.manifest-mode {
  width: 340px;
  max-height: min(72vh, 480px);
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

/* 分组之间用明显的分隔线切开 */
.manifest-group + .manifest-group {
  border-top: 1px solid rgba(0, 0, 0, 0.07);
}

.manifest-group-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: rgba(0, 0, 0, 0.035);
  color: var(--md-strong);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  user-select: none;
}

.manifest-group-count {
  margin-left: auto;
  color: #86868b;
  font-size: 12px;
  font-weight: 400;
}

.manifest-items {
  margin: 0;
  padding: 4px 0 8px;
  list-style: none;
}

.manifest-item {
  padding: 0 8px;
}

.manifest-item-label {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  gap: 9px;
  align-items: start;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 0.12s ease;
}

.manifest-item-label:hover {
  background: rgba(0, 0, 0, 0.04);
}

.manifest-name {
  font-size: 13px;
  word-break: break-all;
}

.manifest-size {
  color: #86868b;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.manifest-size.is-large {
  color: #ff3b30;
  font-weight: 600;
}

.manifest-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
  background: rgba(0, 0, 0, 0.02);
}

.manifest-count {
  margin-right: auto;
  color: #86868b;
  font-size: 12px;
}

input[type='checkbox'] {
  width: 16px;
  height: 16px;
  margin: 1px 0 0;
  border-radius: 5px;
  accent-color: var(--md-accent);
  cursor: pointer;
}
`;
