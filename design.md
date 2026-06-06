# Chrome 浏览器插件——Markdown 编辑器设计文档

## 1. 引言
### 1.1 项目名称
**Markdown Studio**（暂定名）

### 1.2 项目背景
在日常开发和写作中，Markdown 因其简洁和广泛支持成为主流文本格式。用户需要一款能够在浏览器内快速预览、编辑 Markdown 文件，并管理本地文件夹的轻量工具。Chrome 扩展以其便捷性和跨平台特性，非常适合承担该角色。

### 1.3 设计目标
- 提供类似本地 IDE 的 Markdown 编辑体验。
- 支持打开本地文件夹，以树形目录结构管理文件。
- 实时解析文档标题，生成文章大纲并支持跳转。
- 预览与编辑模式无缝切换，支持实时渲染。
- 保证离线可用，无外部网络依赖（核心功能）。

## 2. 功能需求
| 功能模块 | 详细描述 |
| --- | --- |
| **文件夹打开** | 用户通过按钮触发 `showDirectoryPicker()` 选择本地文件夹，读取所有 Markdown 文件及子目录结构。 |
| **目录树展示** | 左侧面板以树形结构展示文件与文件夹，支持折叠/展开，高亮当前编辑文件。 |
| **文件管理** | 点击树节点打开文件内容；支持新建文件/文件夹，重命名，删除（均直接操作本地文件系统）。 |
| **Markdown 编辑** | 使用功能完备的代码编辑器（带语法高亮、行号等），支持撤销/重做、查找替换等基础编辑能力。 |
| **Markdown 预览** | 实时解析 Markdown 为 HTML 并渲染；提供“仅编辑/仅预览/分屏”三种视图模式。 |
| **大纲生成** | 解析编辑器内容中的标题（H1~H6），生成层级化的大纲列表，跟随编辑内容实时更新。 |
| **大纲跳转** | 点击大纲列表中的某一标题，编辑区域光标自动跳转到对应行首，并短暂高亮该行。 |
| **自动保存** | 文件变更后自动写入本地文件（可配手动保存模式）。 |
| **离线使用** | 所有资源打包在扩展内，不依赖远程 CDN。 |

## 3. 技术方案
### 3.1 扩展架构
- **Manifest 版本**: Manifest V3
- **核心页面**: `editor.html` —— 作为独立标签页运行，承载全部 UI 和逻辑。
- **后台脚本**: Service Worker (`background.js`)，用于处理扩展图标点击、生命周期管理，实际文件操作在主页面内通过 File System Access API 完成。
- **权限需求**:
  - `"storage"`：保存用户偏好（主题、视图模式等）。
  - 无需 `"fileSystem"` 权限（V3 中已废弃相关 API），所有本地文件读写通过 `window.showDirectoryPicker()` 动态授权。

### 3.2 技术选型
| 层次 | 技术/库 | 说明 |
| --- | --- | --- |
| 编辑器 | **CodeMirror 6** | 模块化、高性能，原生支持 Markdown 语法高亮、行号、折叠等。 |
| Markdown 解析 | **markdown-it** | 插件化、高速解析，支持 CommonMark，可扩展表格、任务列表等。 |
| 预览渲染 | markdown-it + 自定义样式 | 使用 `markdown-it` 输出 HTML，搭配 GitHub 风格 CSS。 |
| 目录树组件 | 自研（递归组件） | 基于原生 DOM 操作构建虚拟文件树，配合 TreeWalker 逻辑。 |
| 构建工具 | ESBuild / Vite（可选） | 用于打包 CodeMirror、markdown-it 等，输出干净的单文件脚本。 |

### 3.3 数据流设计
1. **选择文件夹** → 获取 `FileSystemDirectoryHandle`，递归遍历生成目录树数据结构。
2. **打开文件** → 从目录树获取 `FileSystemFileHandle`，读取内容写入编辑器。
3. **内容变更** → 编辑器触发 `update` 事件，生成新的大纲数据；同时异步将内容写回文件句柄（防抖）。
4. **大纲交互** → 用户点击大纲项，通过 CodeMirror 的 API 将光标定位至标题所在行首。
5. **视图切换** → 改变布局 CSS 类名，控制编辑区/预览区的显隐或分割比例。

## 4. 系统架构

    ┌─────────────────────────────────────────────────────────────┐
    │  editor.html                                                │
    │  ┌─────────────┬───────────────────────────────┬──────────┐ │
    │  │  Sidebar     │    Main Area                 │  Aside   │ │
    │  │ (File Tree)  │ ┌─────────────────────────┐  │ (Outline)│ │
    │  │             │ │ Editor       Preview     │  │          │ │
    │  │   📁 docs   │ │ (CodeMirror) (Rendered)  │  │  # Intro │ │
    │  │    📄 a.md  │ │                         │  │  ## API  │ │
    │  │    📄 b.md  │ │                         │  │  ...     │ │
    │  │   📁 src    │ └─────────────────────────┘  │          │ │
    │  └─────────────┴───────────────────────────────┴──────────┘ │
    └─────────────────────────────────────────────────────────────┘

### 4.1 模块划分
| 模块名 | 职责 |
| --- | --- |
| **FileSystemModule** | 封装 File System Access API，提供目录读取、文件读写、增删改查等原子操作。 |
| **TreeView** | 根据文件树数据渲染 DOM 树，处理展开折叠、文件点击、右键菜单事件。 |
| **EditorCore** | 初始化 CodeMirror，管理文档状态，暴露设置/获取内容、跳转行、监听变更接口。 |
| **PreviewEngine** | 接受 Markdown 源码，通过 markdown-it 实时生成 HTML，并注入预览容器。 |
| **OutlineManager** | 解析编辑器内容提取标题列表（层级+行号），渲染大纲 UI，响应点击跳转。 |
| **LayoutController** | 管理编辑/预览/分屏模式切换，同步滚动（分屏时可选）。 |
| **PreferenceStore** | 使用 `chrome.storage.local` 读写用户设置（主题、自动保存、视图模式等）。 |

## 5. 详细设计
### 5.1 文件系统模块（FileSystemModule）
**核心方法**：
- `pickDirectory()`：调用 `showDirectoryPicker()`，返回根目录句柄，同时构建并缓存文件树对象。
- `buildTree(handle, path)`：递归读取 `handle` 的子项，过滤非 Markdown 文件（可配置显示所有文件），生成树节点数组。
- `readFile(handle)`：`handle.getFile()` → `file.text()` 返回内容。
- `writeFile(handle, content)`：通过 `handle.createWritable()` 写入内容，处理并发写保护。
- `createFile(parentHandle, name)` / `createDirectory` / `deleteEntry`：操作本地文件系统。

**树节点数据结构**：

    interface TreeNode {
        name: string;
        path: string;           // 相对路径，如 "/docs/readme.md"
        handle: FileSystemHandle;
        type: 'file' | 'directory';
        children?: TreeNode[];
        isOpen?: boolean;       // UI 状态
    }

### 5.2 目录树视图（TreeView）
- 使用 `<ul>/<li>` 嵌套结构渲染，通过 CSS 控制缩进与图标。
- 目录节点支持单击展开/折叠，文件节点单击触发打开操作。
- 提供“新建文件”、“新建文件夹”、“删除”右键菜单（通过 ContextMenu API 或自定义菜单层）。
- 当前激活文件高亮显示。

### 5.3 编辑器核心（EditorCore）
- 基于 **CodeMirror 6**，引入 `@codemirror/lang-markdown`、`@codemirror/view`、`@codemirror/state` 等包。
- 配置主题（亮色/暗色）、行号、自动换行、括号匹配等。
- 暴露接口：
  - `setContent(text)`
  - `getContent() : string`
  - `goToLine(lineNumber)`：调用 `editor.dispatch({ selection: { anchor: lineStart, head: lineStart }, scrollIntoView: true })`
  - `onChange(callback)`：监听 `doc` 变更。
- 跳转后高亮效果：给目标行添加临时 CSS class，2 秒后移除。

### 5.4 预览引擎（PreviewEngine）
- 使用 `markdown-it` 实例，开启 `html`、`linkify`、`typographer`，加载 `markdown-it-task-lists` 等插件。
- 每次编辑器内容变更，经防抖（200ms）后更新预览区 `innerHTML`。
- 在分屏模式下，可选择实现双向滚动同步（基于行数比例）。

### 5.5 大纲管理器（OutlineManager）
- 利用 CodeMirror 的语法树（`syntaxTree`）或简单正则匹配标题行（`/^(#{1,6})\s+(.*)/`），提取 `{ level, text, lineNumber }` 数组。
- 渲染为嵌套或带缩进的列表，显示层级缩进。
- 点击某项时，调用 `EditorCore.goToLine(lineNumber)`。
- 监听编辑器变更实时刷新大纲，保持高亮当前光标所在的标题（可选）。

### 5.6 布局与视图模式
- 三种模式通过 CSS Grid 动态调整：
  - **仅编辑**：`grid-template-columns: 1fr`，隐藏预览。
  - **仅预览**：隐藏编辑器，预览占满。
  - **分屏**：左右各占 `1fr`。
- 模式切换按钮放在工具栏，状态存入 `PreferenceStore`。

### 5.7 自动保存机制
- 编辑器内容变更时触发防抖（800ms），如内容不同于上次保存版本，则调用 `writeFile`。
- 保存状态指示灯：保存中(黄)、已保存(绿)、错误(红)。
- 用户可在设置中关闭自动保存，改为 Ctrl+S 手动保存。

## 6. UI 原型示意

    ┌──────────────────────────────────────────────────────────────┐
    │  Toolbar: [打开文件夹] [视图: 编辑|分屏|预览] [保存状态]  ...  │
    ├──────────┬───────────────────────────────┬───────────────────┤
    │ File Tree│ Editor / Preview              │ Outline           │
    │          │                               │                   │
    │ ▼ docs/  │ # My Document                │ ● My Document     │
    │  readme  │                               │   ○ Introduction │
    │  api.md  │ Some text here...            │   ○ API Reference │
    │ ▼ src/   │                               │     ○ Auth       │
    │  index   │ ## Introduction              │     ○ Data       │
    │          │                               │                   │
    │          │                               │                   │
    ├──────────┴───────────────────────────────┴───────────────────┤
    │  Status Bar: Lines: 42  Words: 380  Cursor: 12:5            │
    └──────────────────────────────────────────────────────────────┘

## 7. 开发实施计划
1. **项目脚手架**：初始化 Manifest V3 扩展结构，搭建基本 `editor.html` 和构建脚本。
2. **文件系统对接**：实现 `showDirectoryPicker` 流程与树节点构建，渲染基础目录树。
3. **编辑器集成**：集成 CodeMirror 6，实现打开文件、读取内容、显示。
4. **预览与大纲**：引入 markdown-it，开发实时预览与大纲生成、跳转功能。
5. **文件操作增强**：新建、删除、重命名，自动/手动保存。
6. **UI 完善**：视图切换、响应式布局、暗色主题、偏好存储。
7. **测试与优化**：大文件性能、边界情况（权限拒绝、文件被外部修改等）、错误处理。
8. **打包发布**：配置构建输出，准备 Chrome Web Store 素材与说明。

## 8. 风险与应对
| 风险 | 应对措施 |
| --- | --- |
| File System Access API 兼容性 | 提供降级方案：使用 `<input webkitdirectory>` 选择文件夹，仅可读取不可保存，提示用户手动下载。 |
| 大文件导致编辑器或预览卡顿 | 对超大文件（>500KB）关闭实时预览，切换为手动刷新；CodeMirror 使用 `viewport` 渲染。 |
| 用户忘记保存或误关闭 | 自动保存 + `beforeunload` 事件提示未保存更改。 |
| 不同操作系统路径分隔符差异 | 统一使用 `/` 处理虚拟路径，显示时按需转换。 |

## 9. 结论
本设计文档详细阐述了“Markdown Studio” Chrome 扩展的整体架构、核心模块及实现路径。通过利用现代浏览器提供的 File System Access API、CodeMirror 6 和 markdown-it，我们能够在浏览器中打造一个接近原生体验的 Markdown 编辑环境，同时满足离线使用、目录管理、大纲跳转等实用需求。后续开发将以此文档为基准，按模块逐步迭代。