/*
 * ============================================================================
 * [markdown-studio 适配缝 3/3]
 *
 * 上游 `confirm()` 用飞书原生 Toast 实现了一个「请点击确认以继续」的确认提示，
 * 只在 `DownloadMethod.ShowSaveFilePicker` 分支且 `navigator.userActivation.isActive`
 * 为假时被调用（见 scripts/download-lark-docx-as-markdown.ts:661-670）。
 *
 * 本仓库把 DownloadMethod 固定为 Direct（适配缝 2），该分支不可达；同时需求明确要求
 * 去掉上游的对话框式交互，因此这里不再实现基于 Toast 的确认框，直接放行。
 * ============================================================================
 */
export const confirm = (): Promise<boolean> => Promise.resolve(true)
