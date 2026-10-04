import i18next from 'i18next'
import { Toast, Docx, docx, type mdast } from '@dolphin/lark'
import { Minute, OneHundred } from '@dolphin/common'
import { safeNormalizeFileName } from '@/lib/utils'
// [markdown-studio 适配缝 4/5] 下载清单与勾选，详见下方 main() 里的插入点
import { applyDownloadSelection } from '@/feishu/download/selection'
// [markdown-studio 适配缝·落盘] 改为「文件夹 + md」并自动在新标签页打开，详见下方 main()
import { saveClipToFolder } from '@/feishu/download/save'
import { cluster } from 'radash'
import { CommonTranslationKey, en, Namespace, zh } from '../common/i18n'
import { reportBug } from '../common/issue'
import {
  transformMentionUsers,
  UniqueFileName,
  withSignal,
  transformTableBySettings,
} from '../common/utils'
import { getSettings, Grid } from '../common/settings'
import { SettingKey } from '@/common/settings'

const uniqueFileName = new UniqueFileName()

const DOWNLOAD_ABORTED = 'Download aborted'

/*
 * 上游把图片/附件放在 `images/`、`files/` 两个子目录里（连同 md 一起打进 zip）。
 * 本仓库统一成 `assets/`，与通用网页分支一致。
 */
const ASSET_DIR = 'assets'

/*
 * [markdown-studio 适配缝 · 文件名保险]
 *
 * 落盘目标从 zip 条目变成了真实文件系统路径：文件名必须合法（Windows 不允许 `:` `*` `?` 等），
 * 也不能带路径分隔符（否则会被写到别的层级）。这里对上游拼出来的名字再做一次规范化，
 * 且**规范化结果同时用于 Markdown 里的引用与磁盘上的文件名**，两者始终一致。
 */
const toAssetFileName = (baseName: string): string =>
  safeNormalizeFileName(baseName) || 'file'

const enum TranslationKey {
  CONTENT_LOADING = 'content_loading',
  UNKNOWN_ERROR = 'unknown_error',
  NOT_SUPPORT = 'not_support',
  NOT_SUPPORT_DOC_1_0 = 'not_support_doc_1_0',
  DOWNLOADING_FILE = 'downloading_file',
  FAILED_TO_DOWNLOAD = 'failed_to_download',
  DOWNLOAD_PROGRESS = 'download_progress',
  DOWNLOAD_COMPLETE = 'download_complete',
  SAVED_TO_FOLDER = 'saved_to_folder',
  STILL_SAVING = 'still_saving',
  IMAGE = 'image',
  FILE = 'file',
  CANCEL = 'cancel',
  SCROLL_DOCUMENT = 'scroll_document',
}

enum ToastKey {
  DOWNLOADING = 'downloading',
  REPORT_BUG = 'report_bug',
}

i18next
  .init({
    lng: docx.language,
    resources: {
      en: {
        translation: {
          [TranslationKey.CONTENT_LOADING]:
            'Part of the content is still loading and cannot be downloaded at the moment. Please wait for loading to complete and retry',
          [TranslationKey.UNKNOWN_ERROR]: 'Unknown error during download',
          [TranslationKey.NOT_SUPPORT]:
            'This is not a lark document page and cannot be downloaded as Markdown',
          [TranslationKey.NOT_SUPPORT_DOC_1_0]:
            'This is a old version lark document page and cannot be downloaded as Markdown',
          [TranslationKey.DOWNLOADING_FILE]:
            'Download {{name}} in: {{progress}}% (please do not refresh or close the page)',
          [TranslationKey.FAILED_TO_DOWNLOAD]: 'Failed to download {{name}}',
          [TranslationKey.STILL_SAVING]:
            'Still saving (please do not refresh or close the page)',
          [TranslationKey.DOWNLOAD_PROGRESS]:
            '{{name}} download progress: {{progress}} %',
          [TranslationKey.DOWNLOAD_COMPLETE]: 'Download complete',
          [TranslationKey.SAVED_TO_FOLDER]:
            'Saved to the "{{folder}}" folder in your downloads and opened in the browser',
          [TranslationKey.IMAGE]: 'Image',
          [TranslationKey.FILE]: 'File',
          [TranslationKey.CANCEL]: 'Cancel',
          [TranslationKey.SCROLL_DOCUMENT]: 'Scrolling to load document',
        },
        ...en,
      },
      zh: {
        translation: {
          [TranslationKey.CONTENT_LOADING]:
            '部分内容仍在加载中，暂时无法下载。请等待加载完成后重试',
          [TranslationKey.UNKNOWN_ERROR]: '下载过程中出现未知错误',
          [TranslationKey.NOT_SUPPORT]:
            '这不是一个飞书文档页面，无法下载为 Markdown',
          [TranslationKey.NOT_SUPPORT_DOC_1_0]:
            '这是一个旧版飞书文档页面，无法下载为 Markdown',
          [TranslationKey.DOWNLOADING_FILE]:
            '下载 {{name}} 中：{{progress}}%（请不要刷新或关闭页面）',
          [TranslationKey.FAILED_TO_DOWNLOAD]: '下载 {{name}} 失败',
          [TranslationKey.STILL_SAVING]: '仍在保存中（请不要刷新或关闭页面）',
          [TranslationKey.DOWNLOAD_PROGRESS]: '{{name}}下载进度：{{progress}}%',
          [TranslationKey.DOWNLOAD_COMPLETE]: '下载完成',
          [TranslationKey.SAVED_TO_FOLDER]:
            '已保存到下载目录的「{{folder}}」文件夹，并已在浏览器中打开',
          [TranslationKey.IMAGE]: '图片',
          [TranslationKey.FILE]: '文件',
          [TranslationKey.CANCEL]: '取消',
          [TranslationKey.SCROLL_DOCUMENT]: '滚动中，以便加载文档',
        },
        ...zh,
      },
    },
  })
  .catch(console.error)

interface ProgressOptions {
  onProgress?: (progress: number) => void
  onComplete?: () => void
}

async function toBlob(
  response: Response,
  options: ProgressOptions = {},
): Promise<Blob> {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status.toFixed()}`)
  }

  if (!response.body) {
    throw new Error('This request has no response body.')
  }

  const { onProgress, onComplete } = options

  const reader = response.body.getReader()
  const contentLength = parseInt(
    response.headers.get('Content-Length') ?? '0',
    10,
  )

  let receivedLength = 0
  const chunks = []

  let _done = false
  while (!_done) {
    const { done, value } = await reader.read()

    _done = done

    if (done) {
      onComplete?.()

      break
    }

    chunks.push(value)
    receivedLength += value.length

    onProgress?.(receivedLength / contentLength)
  }

  const blob = new Blob(chunks)

  return blob
}

const downloadImage = async (
  image: mdast.Image,
  options: {
    signal?: AbortSignal
    useUUID?: boolean
    markdownFileName?: string
  } = {},
): Promise<DownloadResult | null> => {
  if (!image.data) return null

  const { signal, useUUID = false, markdownFileName = '' } = options

  const { name: originName, fetchSources, fetchBlob } = image.data

  const result = await withSignal(
    async isAborted => {
      try {
        // whiteboard
        if (fetchBlob) {
          if (isAborted()) {
            return null
          }

          const content = await fetchBlob()
          if (!content) return null

          const baseName = markdownFileName
            ? `${markdownFileName}-diagram.png`
            : 'diagram.png'
          const safeBaseName = toAssetFileName(baseName)
          const name = useUUID
            ? uniqueFileName.generateWithUUID(safeBaseName)
            : uniqueFileName.generate(safeBaseName)
          const filename = `${ASSET_DIR}/${name}`

          image.url = filename

          return {
            filename,
            content,
          }
        }

        // image
        if (originName && fetchSources) {
          if (isAborted()) {
            return null
          }
          const sources = await fetchSources()
          if (!sources) return null

          const baseName = markdownFileName
            ? `${markdownFileName}-${originName}`
            : originName
          const safeBaseName = toAssetFileName(baseName)
          const name = useUUID
            ? uniqueFileName.generateWithUUID(safeBaseName)
            : uniqueFileName.generate(safeBaseName)
          const filename = `${ASSET_DIR}/${name}`

          const { src } = sources
          if (isAborted()) {
            return null
          }
          const response = await fetch(src, {
            signal,
          })

          try {
            if (isAborted()) {
              return null
            }
            const blob = await toBlob(response, {
              onProgress: progress => {
                if (isAborted()) {
                  Toast.remove(filename)

                  return
                }

                Toast.loading({
                  content: i18next.t(TranslationKey.DOWNLOADING_FILE, {
                    name,
                    progress: Math.floor(progress * OneHundred),
                  }),
                  keepAlive: true,
                  key: filename,
                })
              },
            })

            image.url = filename

            return {
              filename,
              content: blob,
            }
          } finally {
            Toast.remove(filename)
          }
        }

        return null
      } catch (error) {
        const isAbortError =
          isAborted() ||
          (error instanceof DOMException && error.name === 'AbortError')

        if (!isAbortError) {
          Toast.error({
            content: i18next.t(TranslationKey.FAILED_TO_DOWNLOAD, {
              name: originName,
            }),
            actionText: i18next.t(CommonTranslationKey.CONFIRM_REPORT_BUG, {
              ns: Namespace.COMMON,
            }),
            onActionClick: () => {
              reportBug(error)
            },
          })
        }

        return null
      }
    },
    { signal },
  )

  return result
}

const downloadFile = async (
  file: mdast.Link,
  options: {
    signal?: AbortSignal
    useUUID?: boolean
    markdownFileName?: string
  } = {},
): Promise<DownloadResult | null> => {
  if (!file.data?.name || !file.data.fetchFile) return null

  const { signal, useUUID = false, markdownFileName = '' } = options

  const { name, fetchFile } = file.data

  let controller = new AbortController()

  const cancel = () => {
    controller.abort()
  }

  const result = await withSignal(
    async () => {
      try {
        const baseName = markdownFileName ? `${markdownFileName}-${name}` : name
        const safeBaseName = toAssetFileName(baseName)
        const filename = `${ASSET_DIR}/${
          useUUID
            ? uniqueFileName.generateWithUUID(safeBaseName)
            : uniqueFileName.generate(safeBaseName)
        }`

        const response = await fetchFile({ signal: controller.signal })
        try {
          const blob = await toBlob(response, {
            onProgress: progress => {
              Toast.loading({
                content: i18next.t(TranslationKey.DOWNLOADING_FILE, {
                  name,
                  progress: Math.floor(progress * OneHundred),
                }),
                keepAlive: true,
                key: filename,
                actionText: i18next.t(TranslationKey.CANCEL),
                onActionClick: cancel,
              })
            },
          })

          file.url = filename

          return {
            filename,
            content: blob,
          }
        } finally {
          Toast.remove(filename)
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return null
        }

        Toast.error({
          content: i18next.t(TranslationKey.FAILED_TO_DOWNLOAD, {
            name,
          }),
          actionText: i18next.t(CommonTranslationKey.CONFIRM_REPORT_BUG, {
            ns: Namespace.COMMON,
          }),
          onActionClick: () => {
            reportBug(error)
          },
        })

        return null
      }
    },
    { signal, onAbort: cancel },
  )

  // @ts-expect-error remove reference
  controller = null

  return result
}

interface DownloadResult {
  filename: string
  content: Blob
}

type File = mdast.Image | mdast.Link

const downloadFiles = async (
  files: File[],
  options: ProgressOptions & {
    /**
     * @default 3
     */
    batchSize?: number
    signal?: AbortSignal
    useUUID?: boolean
    markdownFileName?: string
  } = {},
): Promise<DownloadResult[]> => {
  const {
    onProgress,
    onComplete,
    batchSize = 3,
    signal,
    useUUID = false,
    markdownFileName = '',
  } = options

  let completeEventCalled = false
  const onCompleteOnce = () => {
    if (!completeEventCalled) {
      completeEventCalled = true
      onComplete?.()
    }
  }

  const results = await withSignal(
    async isAborted => {
      const _results: DownloadResult[] = []

      const totalSize = files.length
      let downloadedSize = 0

      for (const batch of cluster(files, batchSize)) {
        if (isAborted()) {
          break
        }

        await Promise.allSettled(
          batch.map(async file => {
            if (isAborted()) {
              return
            }

            try {
              const result =
                file.type === 'image'
                  ? await downloadImage(file, {
                      signal,
                      useUUID,
                      markdownFileName,
                    })
                  : await downloadFile(file, {
                      signal,
                      useUUID,
                      markdownFileName,
                    })

              if (result) {
                _results.push(result)
              }
            } finally {
              downloadedSize++

              if (!isAborted()) {
                onProgress?.(downloadedSize / totalSize)
              }
            }
          }),
        )
      }

      onCompleteOnce()

      return _results
    },
    {
      signal,
      onAbort: onCompleteOnce,
    },
  )

  return results ?? []
}

interface PrepareResult {
  isReady: boolean
}

const prepare = async (): Promise<PrepareResult> => {
  const checkIsReady = () => docx.isReady({ checkWhiteboard: true })

  /*
   * ==========================================================================
   * [markdown-studio 适配缝 5/5 · 已按要求移除自动滚动]
   *
   * 这里曾有一个「每次下载都自上而下分步滚一遍触发懒加载」的实现（以及上游原有的
   * 「滚到底部 + 等就绪」循环）。现在**完全不自动滚动页面**：只在下载开始前做一次
   * 就绪判定，内容没加载完就沿用上游的提示并中止（`CONTENT_LOADING` + DOWNLOAD_ABORTED），
   * 由用户自己决定滚不滚、什么时候重试 —— 不再替用户滚动、也不再改动滚动位置。
   *
   * 代价（如实说明）：没进过视口的懒加载块不会被加载，未加载的图片/附件/画板会缺失，
   * 与「内容未加载完」同一条提示路径，不伪造也不补内容。
   * ==========================================================================
   */
  return { isReady: checkIsReady() }
}

const main = async (options: { signal?: AbortSignal } = {}) => {
  const { signal } = options


  if (docx.isDoc) {
    Toast.warning({ content: i18next.t(TranslationKey.NOT_SUPPORT_DOC_1_0) })

    throw new Error(DOWNLOAD_ABORTED)
  }

  if (!docx.isDocx) {
    Toast.warning({ content: i18next.t(TranslationKey.NOT_SUPPORT) })

    throw new Error(DOWNLOAD_ABORTED)
  }


  const { isReady } = await prepare()


  if (!isReady) {
    Toast.warning({
      content: i18next.t(TranslationKey.CONTENT_LOADING),
    })

    throw new Error(DOWNLOAD_ABORTED)
  }

  const settings = await getSettings([
    SettingKey.Table,
    SettingKey.Grid,
    SettingKey.TextHighlight,
    SettingKey.DownloadFileWithUniqueName,
  ])


  const { root, images, files, tableWithParents, mentionUsers } =
    docx.intoMarkdownAST({
      whiteboard: true,
      diagram: true,
      file: true,
      highlight: settings[SettingKey.TextHighlight],
      flatGrid: settings[SettingKey.Grid] === Grid.Flatten,
    })


  await transformMentionUsers(mentionUsers)


  /*
   * ==========================================================================
   * [markdown-studio 适配缝 4/5]
   *
   * 下载清单与勾选：把「待下载清单」报给悬浮 UI，等用户勾选，再按勾选结果过滤
   * images / files（原地剔除，不碰 root —— 未勾选项在 Markdown 里仍是原来的
   * 空链接形态，与上游单个文件下载失败时的表现一致）。
   *
   * 必须在真正下载之前完成：未勾选项不该被下载，也不该出现在清单之外的地方。
   * 未经清单流程时（例如直接跑上游脚本）本函数立即返回，行为与上游 100% 一致。
   * ==========================================================================
   */
  await applyDownloadSelection({ images, files })


  const recommendName = docx.pageTitle
    ? safeNormalizeFileName(docx.pageTitle.slice(0, OneHundred))
    : 'doc'
  const markdownName = `${recommendName}.md`

  /*
   * ========================================================================
   * [markdown-studio 适配缝 · 落盘] 改为「文件夹 + md」，不再打 zip。
   *
   * 上游把 `images/`、`files/` 两个子目录连同 md 一起打进 zip；这里改成在浏览器默认
   * 下载目录下建 `<标题>/`：两个子目录统一为 `assets/`（与通用网页分支一致），md 直接
   * 放在文件夹根下，写完自动在新标签页打开。因此 `isZip` / `.zip` 后缀 /
   * ShowSaveFilePicker 分支全部去掉 —— 输出形态只有一种。落盘通道见
   * src/feishu/download/save.ts。
   * ========================================================================
   */
  Toast.loading({
    content: i18next.t(TranslationKey.STILL_SAVING),
    keepAlive: true,
    key: ToastKey.DOWNLOADING,
  })

  const imgs = images.filter(image => image.data?.fetchSources)
  const diagrams = images.filter(image => image.data?.fetchBlob)

  const results = await Promise.all([
    downloadFiles(imgs, {
      batchSize: 15,
      onProgress: progress => {
        Toast.loading({
          content: i18next.t(TranslationKey.DOWNLOAD_PROGRESS, {
            name: i18next.t(TranslationKey.IMAGE),
            progress: Math.floor(progress * OneHundred),
          }),
          keepAlive: true,
          key: TranslationKey.IMAGE,
        })
      },
      onComplete: () => {
        Toast.remove(TranslationKey.IMAGE)
      },
      signal,
      useUUID: settings[SettingKey.DownloadFileWithUniqueName],
      markdownFileName: recommendName,
    }),
    // Diagrams must be downloaded one by one
    downloadFiles(diagrams, {
      batchSize: 1,
      signal,
      useUUID: settings[SettingKey.DownloadFileWithUniqueName],
      markdownFileName: recommendName,
    }),
    downloadFiles(files, {
      onProgress: progress => {
        Toast.loading({
          content: i18next.t(TranslationKey.DOWNLOAD_PROGRESS, {
            name: i18next.t(TranslationKey.FILE),
            progress: Math.floor(progress * OneHundred),
          }),
          keepAlive: true,
          key: TranslationKey.FILE,
        })
      },
      onComplete: () => {
        Toast.remove(TranslationKey.FILE)
      },
      signal,
      useUUID: settings[SettingKey.DownloadFileWithUniqueName],
      markdownFileName: recommendName,
    }),
  ])

  const entries = results.flat(1)

  // 表格形态由设置决定，必须在 stringify 之前应用（与上游单文件路径一致）
  transformTableBySettings(tableWithParents, settings)

  const markdown = Docx.stringify(root)

  const saved = await saveClipToFolder({
    folder: recommendName,
    markdownName,
    markdown,
    assets: entries.map(entry => ({ path: entry.filename, blob: entry.content })),
  })

  return saved
}

let controller = new AbortController()
main({
  signal: controller.signal,
})
  .then(saved => {
    Toast.success({
      content: i18next.t(TranslationKey.SAVED_TO_FOLDER, { folder: saved.folder }),
    })
  })
  .catch((error: unknown) => {
    const aborted =
      error instanceof Error &&
      (error.name === 'AbortError' || error.message === DOWNLOAD_ABORTED)

    if (aborted) {
      controller.abort()
    } else {
      Toast.error({
        key: ToastKey.REPORT_BUG,
        content: String(error),
        actionText: i18next.t(CommonTranslationKey.CONFIRM_REPORT_BUG, {
          ns: Namespace.COMMON,
        }),
        duration: Minute,
        onActionClick: () => {
          reportBug(error)

          Toast.remove(ToastKey.REPORT_BUG)
        },
      })
    }
  })
  .finally(() => {
    Toast.remove(ToastKey.DOWNLOADING)

    // @ts-expect-error remove reference
    controller = null
  })
