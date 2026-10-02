/*
 * 构建飞书相关的两个经典脚本（IIFE）。
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
  // 集成层模块：供 vendored 下载脚本按适配缝调用（下载清单、勾选过滤）
  '@/feishu': resolve(projectRoot, 'src/feishu')
};

const BUNDLES = [
  {
    entry: 'src/feishu/content/index.js',
    fileName: 'feishu-content.js',
    name: 'MarkdownStudioFeishuContent'
  },
  {
    entry: 'src/feishu/download/index.js',
    fileName: 'feishu-download.js',
    name: 'MarkdownStudioFeishuDownload'
  }
];

for (const bundle of BUNDLES) {
  await build({
    configFile: false,
    root: projectRoot,
    // public/ 已经由主构建复制进 dist/，这里不要重复复制
    publicDir: false,
    resolve: { alias },
    build: {
      outDir: 'dist/bundles',
      emptyOutDir: false,
      target: 'chrome110',
      // 保留可读性：便于直接核对与上游一致的下载逻辑
      minify: false,
      sourcemap: false,
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
