/*
 * ============================================================================
 * [markdown-studio 适配缝 3/3]
 *
 * 上游 `reportBug()` 会拼一个 GitHub issue URL 并 `window.open` 到
 * cloud-document-converter 仓库的 issue 页面（依赖 `../../package.json` 的 version，
 * 以及 serialize-error / i18next 模板）。它只由被移除的上游 Toast 的「报告错误」按钮
 * 回调触发，本仓库不提供该入口（需求要求去掉对话框式交互），因此改为仅记录到控制台，
 * 避免把错误上报到与本项目无关的仓库。
 * ============================================================================
 */
export const reportBug = (error: unknown): void => {
  console.error('[markdown-studio] 下载过程中捕获到错误：', error)
}
