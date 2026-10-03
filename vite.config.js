import { defineConfig } from 'vite';

export default defineConfig({
  /*
   * 强制 ASCII 输出（非 ASCII 一律转成 \uXXXX 转义，语义等价）。
   *
   * 原因：katex / temml 这类依赖的产物里带有原始 Unicode「非字符」（如 U+FFFF），
   * 而 Chromium 读取被注入的脚本时用的是严格校验 base::IsStringUTF8 —— 非字符会被
   * 判为「不是 UTF-8」，报错 "It isn't UTF-8 encoded."。编辑器页的 chunk 目前由扩展页
   * 以 module 方式加载、不走这条校验，但把整个扩展的 JS 统一成 ASCII 就没有这类隐患。
   *
   * 依赖侧已确认没有任何 String.raw 用法，因此转义不会改变运行时语义。
   */
  esbuild: { charset: 'ascii' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: 'editor.html'
      }
    }
  }
});
