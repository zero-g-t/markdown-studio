import i18next from 'i18next'
import { Toast, Docx, docx, type mdast } from '@dolphin/lark'
import { Minute, OneHundred } from '@dolphin/common'
import { fileSave, supported } from 'browser-fs-access'
import { BlobReader, TextReader, ZipWriter, configure } from '@zip.js/zip.js'
import { safeNormalizeFileName } from '@/lib/utils'
// [markdown-studio 适配缝 4/5] 下载清单与勾选，详见下方 main() 里的插入点
import { applyDownloadSelection } from '@/feishu/download/selection'
import { cluster } from 'radash'
import { CommonTranslationKey, en, Namespace, zh } from '../common/i18n'
import { confirm } from '../common/notification'
import { legacyFileSave } from '../common/legacy'
import { reportBug } from '../common/issue'
// [临时诊断] 面包屑：同时进 console.error 与悬浮面板条目。定位完删除。
import { diagStep } from '@/feishu/download/toast-bridge'
import {
  transformMentionUsers,
  UniqueFileName,
  withSignal,
  transformTableBySettings,
} from '../common/utils'
import { getSettings, Grid } from '../common/settings'
import { DownloadMethod, SettingKey } from '@/common/settings'

configure({ useWebWorkers: false })

const uniqueFileName = new UniqueFileName()

const DOWNLOAD_ABORTED = 'Download aborted'

const enum TranslationKey {
  CONTENT_LOADING = 'content_loading',
  UNKNOWN_ERROR = 'unknown_error',
  NOT_SUPPORT = 'not_support',
  NOT_SUPPORT_DOC_1_0 = 'not_support_doc_1_0',
  DOWNLOADING_FILE = 'downloading_file',
  FAILED_TO_DOWNLOAD = 'failed_to_download',
  DOWNLOAD_PROGRESS = 'download_progress',
  DOWNLOAD_COMPLETE = 'download_complete',
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
          const name = useUUID
            ? uniqueFileName.generateWithUUID(baseName)
            : uniqueFileName.generate(baseName)
          const filename = `images/${name}`

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
          const name = useUUID
            ? uniqueFileName.generateWithUUID(baseName)
            : uniqueFileName.generate(baseName)
          const filename = `images/${name}`

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
        const filename = `files/${
          useUUID
            ? uniqueFileName.generateWithUUID(baseName)
            : uniqueFileName.generate(baseName)
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

  // [临时诊断] 面包屑：定位飞书「undefined」失败发生在哪一步。定位完删除（A~J 共 10 处）。
  diagStep('[md-studio][diag] step A 进入 main')

  if (docx.isDoc) {
    Toast.warning({ content: i18next.t(TranslationKey.NOT_SUPPORT_DOC_1_0) })

    throw new Error(DOWNLOAD_ABORTED)
  }

  if (!docx.isDocx) {
    Toast.warning({ content: i18next.t(TranslationKey.NOT_SUPPORT) })

    throw new Error(DOWNLOAD_ABORTED)
  }

  // [临时诊断]
  diagStep('[md-studio][diag] step B 通过 isDoc/isDocx 检查')

  const { isReady } = await prepare()

  // [临时诊断]
  diagStep('[md-studio][diag] step C prepare 完成 | isReady =', isReady)

  if (!isReady) {
    Toast.warning({
      content: i18next.t(TranslationKey.CONTENT_LOADING),
    })

    throw new Error(DOWNLOAD_ABORTED)
  }

  const settings = await getSettings([
    SettingKey.DownloadMethod,
    SettingKey.Table,
    SettingKey.Grid,
    SettingKey.TextHighlight,
    SettingKey.DownloadFileWithUniqueName,
  ])

  // [临时诊断]
  diagStep('[md-studio][diag] step D getSettings 完成')

  const { root, images, files, tableWithParents, mentionUsers } =
    docx.intoMarkdownAST({
      whiteboard: true,
      diagram: true,
      file: true,
      highlight: settings[SettingKey.TextHighlight],
      flatGrid: settings[SettingKey.Grid] === Grid.Flatten,
    })

  // [临时诊断]
  diagStep(
    '[md-studio][diag] step E intoMarkdownAST 完成 | images =',
    images.length,
    '| files =',
    files.length,
    '| mentions =',
    mentionUsers.length,
  )

  await transformMentionUsers(mentionUsers)

  // [临时诊断]
  diagStep('[md-studio][diag] step F transformMentionUsers 完成')

  /*
   * ==========================================================================
   * [markdown-studio 适配缝 4/5]
   *
   * 下载清单与勾选：把「待下载清单」报给悬浮 UI，等用户勾选，再按勾选结果过滤
   * images / files（原地剔除，不碰 root —— 未勾选项在 Markdown 里仍是原来的
   * 空链接形态，与上游单个文件下载失败时的表现一致）。
   *
   * 必须在计算 isZip / ext / filename 之前完成，否则一项都不勾也会给出 .zip 后缀。
   * 未经清单流程时（例如直接跑上游脚本）本函数立即返回，行为与上游 100% 一致。
   * ==========================================================================
   */
  await applyDownloadSelection({ images, files })

  // [临时诊断]
  diagStep('[md-studio][diag] step G applyDownloadSelection 完成')

  const recommendName = docx.pageTitle
    ? safeNormalizeFileName(docx.pageTitle.slice(0, OneHundred))
    : 'doc'
  const isZip = images.length > 0 || files.length > 0
  const ext = isZip ? '.zip' : '.md'
  const filename = `${recommendName}${ext}`

  const toBlob = async () => {
    // [临时诊断]
    diagStep('[md-studio][diag] step H toBlob 开始 | isZip =', isZip)

    Toast.loading({
      content: i18next.t(TranslationKey.STILL_SAVING),
      keepAlive: true,
      key: ToastKey.DOWNLOADING,
    })

    const singleFileContent = () => {
      transformTableBySettings(tableWithParents, settings)

      const markdown = Docx.stringify(root)

      return new Blob([markdown])
    }

    const zipFileContent = async () => {
      /*
       * ======================================================================
       * [markdown-studio 适配缝 6/6] 打包改用 zip.js 低层 API。
       *
       * 原来用 `new fs.FS()` + `addBlob/addText` + `exportBlob()`：exportBlob 走
       * zip-fs 的并发导出层（bufferedWrite，所有条目并行写入），而该层把子条目的失败
       * 原样再抛（`throw errorResult.reason`），里层还有多处「无原因」的流拆除
       * （`abort()` / `error(reason)` / `throw cancelReason`，reason 可能是 undefined）。
       * 结果：只要内部某一步失败，上层只能拿到一个「无原因的 undefined 拒绝」——
       * 实测就是面板只报 undefined，既定位不到原因也修不了。
       *
       * 低层 API 顺序写入（一次只写一个条目）、错误原样冒泡带堆栈，且不再触发 fs 层的
       * 临时 blob 溢写机制。zip 内容与原来一致（条目名不变，仍含 `images/` 前缀）。
       * ======================================================================
       */
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
      // [临时诊断]
      diagStep(
        '[md-studio][diag] step I downloadFiles 完成 | 三个分组结果 =',
        results.map(group => (Array.isArray(group) ? group.length : typeof group)).join('/'),
      )

      const entries = results.flat(1)
      // [临时诊断] 压缩前把待写入的条目（名字 + 字节数）打出来：名字异常/空文件一眼可见
      diagStep(
        '[md-studio][diag] step K 待写入条目 =',
        entries.map(({ filename, content }) => `${filename}(${content?.size ?? '?'})`).join(', ').slice(0, 400),
      )

      /*
       * 输出侧不用 `BlobWriter`（它的内部临时 blob 机制在 Chrome 下输出超过约 10MiB 就失败，
       * 且把错误吞成「无原因的 undefined 拒绝」；zip.js 2.22.0 实测，Node 下不复现）。
       * 改用普通 WritableStream 收分片、最后自己拼 Blob：实测 12MB 单条 / 18MB 三条均正常。
       */
      const zipChunks: Uint8Array[] = []
      const zipWriter = new ZipWriter(
        new WritableStream<Uint8Array>({
          write(chunk) {
            zipChunks.push(chunk)
          }
        })
      )

      for (const { filename, content } of entries) {
        // [临时诊断] 顺序写入：最后一条日志就是出错的条目
        diagStep('[md-studio][diag] step K1 写入', filename, content.size)
        await zipWriter.add(filename, new BlobReader(content))
      }

      transformTableBySettings(tableWithParents, settings)

      const markdown = Docx.stringify(root)
      diagStep('[md-studio][diag] step K2 md 生成完成 | 长度 =', markdown.length)

      await zipWriter.add(`${recommendName}.md`, new TextReader(markdown))
      await zipWriter.close()
      diagStep('[md-studio][diag] step K3 zip 写入完成')

      return new Blob(zipChunks, { type: 'application/zip' })
    }

    const content = isZip ? await zipFileContent() : singleFileContent()

    // [临时诊断]
    diagStep('[md-studio][diag] step J toBlob 完成 | blob.size =', content.size)

    return content
  }

  if (
    settings[SettingKey.DownloadMethod] === DownloadMethod.ShowSaveFilePicker &&
    supported
  ) {
    if (!navigator.userActivation.isActive) {
      const confirmed = await confirm()
      if (!confirmed) {
        throw new Error(DOWNLOAD_ABORTED)
      }
    }

    await fileSave(toBlob(), {
      fileName: filename,
      extensions: [ext],
    })
  } else {
    const blob = await toBlob()

    legacyFileSave(blob, {
      fileName: filename,
    })
  }
}

let controller = new AbortController()
main({
  signal: controller.signal,
})
  .then(() => {
    Toast.success({
      content: i18next.t(TranslationKey.DOWNLOAD_COMPLETE),
    })
  })
  .catch((error: unknown) => {
    // [临时诊断] 定位飞书「undefined」失败：把 main() 的原始拒绝值/栈打到 console 与面板。定位完删除。
    console.error(
      '[md-studio][diag] feishu main() rejected | typeof =',
      typeof error,
      '| value =',
      error,
      '| stack =',
      (error as { stack?: string } | null | undefined)?.stack,
    )

    diagStep(
      '[md-studio][diag] step REJECTED | typeof =',
      typeof error,
      '| value =',
      String(error),
    )

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
