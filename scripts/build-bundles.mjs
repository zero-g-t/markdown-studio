/*
 * 构建站点适配器相关的经典脚本（IIFE）。
 *
 * 为什么单独一个脚本：
 *   · 内容脚本与被 chrome.scripting 注入的脚本都必须是经典脚本，不能用 ESM 输出；
 *   · Rollup 的 IIFE 格式不接受多入口，所以每个脚本单独跑一次 Vite 构建；
 *   · 主构建（vite build，产出 editor.html）会把 dist/ 清空，因此本脚本必须在它之后运行，
 *     并以 emptyOutDir: false 追加产物。
 */
import { build } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 与 src/feishu/* 里使用的路径别名保持一致，让搬运过来的上游源码无需改动 import 语句。
const alias = {
  '@dolphin/lark': resolve(projectRoot, 'src/vendor/lark/index.ts'),
  '@dolphin/common': resolve(projectRoot, 'src/vendor/common/index.ts'),
  '@/common': resolve(projectRoot, 'src/vendor/converter/common'),
  '@/lib': resolve(projectRoot, 'src/vendor/converter/lib'),
  // 集成层模块：供 vendored 下载脚本按适配缝调用（下载清单、勾选过滤），
  // 通用网页分支也复用它导出的清单握手
  '@/feishu': resolve(projectRoot, 'src/feishu')
};

const BUNDLES = [
  {
    // 内容脚本（ISOLATED world）：两个站点适配器共用同一份悬浮 UI 与阶段机
    entry: 'src/feishu/content/index.js',
    fileName: 'feishu-content.js',
    name: 'MarkdownStudioFeishuContent'
  },
  {
    // 飞书分支转换器（MAIN world）
    entry: 'src/feishu/download/index.js',
    fileName: 'feishu-download.js',
    name: 'MarkdownStudioFeishuDownload'
  },
  {
    // 通用网页分支转换器（MAIN world）：defuddle 提取 + HTML→Markdown + 图片本地化
    entry: 'src/web/download/index.js',
    fileName: 'web-download.js',
    name: 'MarkdownStudioWebDownload'
  }
];

for (const bundle of BUNDLES) {
  await build({
    configFile: false,
    root: projectRoot,
    // public/ 已经由主构建复制进 dist/，这里不要重复复制
    publicDir: false,
    resolve: { alias },
    // 见下方 charset 说明：必须写在顶层（Vite 用它驱动 esbuild 压缩），写在 build 下不生效
    esbuild: { charset: 'ascii' },
    build: {
      outDir: 'dist/bundles',
      emptyOutDir: false,
      target: 'chrome110',
      // 产物是要分发/上架的构建产物，按规范压缩（esbuild 默认即是本值）。
      // 不要把 minify 关掉来"便于阅读"：第三方库本就是压缩过的，放不放大都无法阅读，
      // 而上游搬运逻辑的可读版本在 src/vendor/ 里受版本管理。需要排查产物时用 sourcemap，
      // 而不是不压缩。
      minify: true,
      sourcemap: false,
      /*
       * 强制 ASCII 输出：这三个 bundle 都会被 Chrome 当 UTF-8 读取
       * （内容脚本由 manifest 注入，转换器由 chrome.scripting.executeScript 注入），
       * 而 Chromium 用的是严格校验 base::IsStringUTF8 —— 它把 Unicode「非字符」
       * （U+FDD0~U+FDEF、U+nFFFE/U+nFFFF）判为非法，报错文案就是
       * "It isn't UTF-8 encoded."。
       *
       * 触发源在依赖里：defuddle 的数学依赖 temml 的产物含一个原始 U+FFFF
       * （node_modules/temml/dist/temml.min.js），它又写在模板字符串里，
       * 逐字透传到了我们的产物。把所有非 ASCII 转成 \uXXXX 转义即可彻底规避这类问题，
       * 语义不变（字符串/正则里等价），Obsidian Web Clipper 也是这么做的（terser ascii_only）。
       *
       * 注意：这一项必须写在 Vite 配置顶层（本文件中的 esbuild 字段），
       * 写在 build 下不会被压缩阶段读取 —— 实测无效。
       */
      lib: {
        entry: resolve(projectRoot, bundle.entry),
        name: bundle.name,
        formats: ['iife'],
        fileName: () => bundle.fileName
      }
    }
  });

  console.log(`[bundles] dist/bundles/${bundle.fileName}`);
}
