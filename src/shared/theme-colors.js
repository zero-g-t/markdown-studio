// 主题色表：编辑器页面（src/main.js）与飞书页面上的悬浮按钮（src/feishu/content）共用同一份，
// 保证「在编辑器里切主题色 → 飞书页面按钮跟着变」永远同源，不会出现两套色板漂移。
//
// 只保留三种：纯白（中性黑白，苹果式极简）、深蓝、护眼绿。
export const THEME_COLORS = [
  {
    id: 'white',
    label: '纯白',
    hue: 220,
    accent: '#1d1d1f',
    strong: '#1d1d1f',
    soft: '#f5f5f7',
    // 纯白主题要走中性灰表面，不能让固定饱和度的色相推导把底色染蓝，故直接给整套表面色
    surfaces: {
      subtle: '#fafafa',
      muted: '#f4f4f5',
      border: '#e5e5e7',
      borderStrong: '#d2d2d7',
      canvas: '#f7f7f8',
      textMuted: '#71717a'
    }
  },
  {
    id: 'blue',
    label: '深蓝',
    hue: 221,
    accent: '#1d4ed8',
    strong: '#1e3a8a',
    soft: '#e4ebfb'
  },
  {
    id: 'green',
    label: '护眼绿',
    hue: 145,
    accent: '#2f9e6b',
    strong: '#1f7a4f',
    soft: '#e3f4ea'
  }
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

// 主题自带 surfaces 时优先用它的中性色板，否则按色相推导
export function resolveThemeSurfaces(theme) {
  return theme.surfaces || themeSurfacePalette(theme.hue);
}

export function resolveThemeColor(id) {
  return THEME_COLORS.find((theme) => theme.id === id) || THEME_COLORS[0];
}
