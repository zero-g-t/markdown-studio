import { pick } from 'es-toolkit'

export enum SettingKey {
  Locale = 'general.locale',
  Theme = 'general.theme',
  DownloadMethod = 'download.method',
  Table = 'general.table',
  Grid = 'general.grid',
  TextHighlight = 'general.text_highlight',
  DownloadFileWithUniqueName = 'download.file_with_unique_name',
}

export enum Theme {
  Light = 'light',
  Dark = 'dark',
  System = 'system',
}

export enum DownloadMethod {
  Direct = 'direct',
  ShowSaveFilePicker = 'showSaveFilePicker',
}

export enum Table {
  Filtered = 'filtered',
  NonPhrasingContentToHTML = 'nonPhrasingContentToHTML',
  ToHTML = 'toHTML',
}

export enum Grid {
  Flatten = 'flatten',
  ToTable = 'toTable',
  ToHTML = 'toHTML',
}

export interface Settings {
  [SettingKey.Locale]: string
  [SettingKey.Theme]: (typeof Theme)[keyof typeof Theme]
  [SettingKey.DownloadMethod]: (typeof DownloadMethod)[keyof typeof DownloadMethod]
  [SettingKey.Table]: (typeof Table)[keyof typeof Table]
  [SettingKey.Grid]: (typeof Grid)[keyof typeof Grid]
  [SettingKey.TextHighlight]: boolean
  [SettingKey.DownloadFileWithUniqueName]: boolean
}

/*
 * ============================================================================
 * [markdown-studio 适配缝 2/3]
 *
 * 上游两处行为：
 *   1. `fallbackSettings[DownloadMethod]` 在支持 File System Access API 的浏览器上
 *      默认取 `ShowSaveFilePicker`（即点下载后弹系统「另存为」对话框）；
 *   2. `getSettings()` 通过 `portImpl`（window.postMessage 端口）向 background 读取
 *      `chrome.storage.sync` 中的用户设置，失败时回落到 `fallbackSettings`。
 *
 * 本仓库的产品决策 D1是「点一下直接下载到浏览器默认下载目录，不弹对话框」，
 * 且 v1 不提供这些设置项的 UI，因此这里把设置固定为上表取值：
 * 除 `DownloadMethod` 外的所有取值与上游 `fallbackSettings` 逐字一致。
 *
 * 下载算法本体（src/vendor/converter/scripts/download-lark-docx-as-markdown.ts）
 * 未做任何改动，仍然按 `getSettings()` 的返回值分支执行。
 * ============================================================================
 */
export const fallbackSettings: Settings = {
  [SettingKey.Locale]: 'en-US',
  [SettingKey.Theme]: Theme.System,
  [SettingKey.DownloadMethod]: DownloadMethod.Direct,
  [SettingKey.Table]: Table.NonPhrasingContentToHTML,
  [SettingKey.Grid]: Grid.Flatten,
  [SettingKey.TextHighlight]: true,
  [SettingKey.DownloadFileWithUniqueName]: false,
}

export const getSettings = async <Key extends keyof Settings>(
  keys: Key[],
): Promise<Pick<Settings, Key>> => pick(fallbackSettings, keys)
