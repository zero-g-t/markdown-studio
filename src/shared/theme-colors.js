// 主题色表：编辑器页面（src/main.js）与飞书页面上的悬浮按钮（src/feishu/content）共用同一份，
// 保证「在编辑器里切主题色 → 飞书页面按钮跟着变」永远同源，不会出现两套色板漂移。
export const THEME_COLORS = [
  { id: 'teal', label: '青绿', hue: 170, accent: '#237a6b', strong: '#16594d', soft: '#dceee8' },
  { id: 'blue', label: '靛蓝', hue: 221, accent: '#2563eb', strong: '#1d4ed8', soft: '#dbeafe' },
  { id: 'violet', label: '紫罗兰', hue: 262, accent: '#7c3aed', strong: '#5b21b6', soft: '#ede9fe' },
  { id: 'amber', label: '琥珀', hue: 28, accent: '#b45309', strong: '#92400e', soft: '#fef3c7' },
  { id: 'rose', label: '玫红', hue: 347, accent: '#e11d48', strong: '#be123c', soft: '#ffe4e6' }
];

export const DEFAULT_THEME_COLOR = THEME_COLORS[0].id;

// 侧栏、按钮等中性底色统一由主题色相推导，保证切换主题色后整套界面同色系。
export function themeSurfacePalette(hue) {
  return {
    subtle: `hsl(${hue}, 34%, 97.5%)`,
    muted: `hsl(${hue}, 32%, 93.5%)`,
    border: `hsl(${hue}, 18%, 85%)`,
    borderStrong: `hsl(${hue}, 18%, 74%)`,
    canvas: `hsl(${hue}, 28%, 96.5%)`,
    textMuted: `hsl(${hue}, 12%, 42%)`
  };
}

export function resolveThemeColor(id) {
  return THEME_COLORS.find((theme) => theme.id === id) || THEME_COLORS[0];
}
