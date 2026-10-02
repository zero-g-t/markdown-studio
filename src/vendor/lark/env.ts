// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {}

interface ToastOptions {
  key?: string
  content: string
  actionText?: string
  duration?: number
  keepAlive?: boolean
  closable?: boolean
  onActionClick?: () => void
  onClose?: () => void
}

export interface Toast {
  error: (options: ToastOptions) => void
  warning: (options: ToastOptions) => void
  info: (options: ToastOptions) => void
  loading: (options: ToastOptions) => void
  success: (options: ToastOptions) => void
  remove: (key: string) => void
}

const defaultToast: Toast = {
  error: noop,
  warning: noop,
  info: noop,
  loading: noop,
  success: noop,
  remove: noop,
}

/*
 * ============================================================================
 * [markdown-studio 适配缝 1/3]
 *
 * 上游行为：`Toast` 直接取飞书页面自带的 `window.Toast`，因此「仍在保存中」、
 * 「正在下载 xxx」等提示会以飞书原生弹窗形式出现。
 *
 * 本仓库需要把这套弹窗换成「悬浮按钮 + 圆形进度环 + 状态面板」，因此把 `Toast`
 * 改为一个稳定包装对象：内部指向一个可替换的引用。宿主可在注入后调用
 * `setToast()` 换成自己的实现；**未调用 `setToast()` 时行为与上游完全一致**
 * （仍然走 `window.Toast`）。
 *
 * 之所以用包装对象而不是 `export let Toast`，是为了让求值顺序不再敏感：
 * 打包器可能把下载模块内联并提前求值，包装对象在调用时才解引用，始终取到当前实现。
 * ============================================================================
 */
const toastRef: { current: Toast } = { current: window.Toast ?? defaultToast }

export const setToast = (toast: Toast): void => {
  toastRef.current = toast
}

export const Toast: Toast = {
  error: options => {
    toastRef.current.error(options)
  },
  warning: options => {
    toastRef.current.warning(options)
  },
  info: options => {
    toastRef.current.info(options)
  },
  loading: options => {
    toastRef.current.loading(options)
  },
  success: options => {
    toastRef.current.success(options)
  },
  remove: key => {
    toastRef.current.remove(key)
  },
}

export interface User {
  language: string
}

export const User: User | undefined = window.User

export interface PageMain {
  blockManager: {
    /**
     * @deprecated
     */
    model?: {
      rootBlockModel: import('./docx').PageBlock
    }
    rootBlockModel: import('./docx').PageBlock
  }

  locateBlockWithRecordIdImpl(
    recordId: string,
    options?: Record<string, unknown>,
  ): Promise<boolean>
}

export const PageMain: PageMain | undefined = window.PageMain

export const isDoc = (): boolean => window.editor !== undefined
export const isDocx = (): boolean => window.PageMain !== undefined
