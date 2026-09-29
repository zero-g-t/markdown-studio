# Markdown Studio

一个运行在浏览器里的本地 Markdown 编辑器 Chrome 扩展（Manifest V3）。它以“本地文件夹即工作区”的方式工作：直接读写你磁盘上的 `.md` 文件，提供类 IDE 的三栏工作区（文件树 / 编辑器+预览 / 大纲），支持实时预览、Mermaid 图表、大纲跳转、滚动同步、自动保存与会话恢复。

所有资源随扩展打包，**完全离线运行，不依赖任何远程 CDN**。

---

## 1. 快速开始

### 1.1 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | ≥ 18（推荐 LTS，本机实测 v24.15.0） |
| npm | ≥ 9（本机实测 v11.12.1） |
| 浏览器 | Chrome / Edge 等基于 Chromium 的内核（依赖 File System Access API） |
| 网络 | 仅安装依赖时需要；运行与打包后的使用均离线 |

### 1.2 安装依赖

```bash
npm install
# 或严格按照 package-lock.json 安装
npm ci
```

### 1.3 开发调试

```bash
npm run dev       # 启动 Vite 开发服务器 http://127.0.0.1:5173
npm run preview   # 本地静态预览 dist 目录产物
```

> 注意：扩展页依赖 `chrome.*` API 与 File System Access API，**功能验证请以“加载构建产物”的方式为准**（见 3.2），`npm run dev` 主要用于样式与逻辑的快速迭代。

### 1.4 构建正式包（推荐）

项目根目录提供了 Windows 打包脚本：

```bat
build.bat
```

它会自动完成：环境检查 → 安装依赖（缺失时 `npm ci`）→ `npm run build` → 校验产物 → 压缩到 `release\markdown-studio-<版本号>.zip`。

---

## 2. 功能一览

### 2.1 文件系统与目录管理

- **打开本地文件夹**：通过 `showDirectoryPicker()` 选择任意本地目录作为工作区，直接读写真实文件（不是上传、也不是浏览器沙箱副本）。
- **目录树**：懒加载展开子目录；目录排在文件之前，同级按名称排序；当前编辑文件高亮显示。
- **历史目录**：最近打开过的目录句柄存放在 IndexedDB 中（最多 10 条），侧边栏列表可一键重新打开或删除，支持折叠。
- **文件管理（右键菜单）**：新建文件、新建文件夹、重命名、删除，均直接作用于本地文件系统；根目录面板也提供“新建 Markdown 文件”快捷按钮。
- **文件类型支持**：`.md` / `.markdown` / `.mdown` / `.mkd` 走 Markdown 编辑与渲染链路；`.txt` 走纯文本只读预览。
- **会话恢复**：重新打开扩展时自动恢复上次工作目录与上次打开的文件；未绑定文件的编辑内容会写入文档快照（防抖 300ms），避免意外关闭丢内容。

### 2.2 编辑器（CodeMirror 6）

- Markdown 语法高亮、行号、当前行/选区高亮、自动换行、`Tab` 缩进（`indentWithTab`）。
- `basicSetup`：撤销/重做、括号匹配与自动闭合、自动缩进、自动补全提示、多光标、矩形选择、代码折叠等。
- 查找替换：`@codemirror/search` 已在依赖中，但尚未接入 `search()` 扩展，因此目前**还没有搜索面板**（`Ctrl/Cmd + F` 暂不生效）。
- 行内高亮：大纲跳转后目标行闪烁高亮约 1.2 秒。

### 2.3 预览（markdown-it）

- 启用 `html`、`linkify`、`typographer`、`breaks`。
- **任务列表**：`markdown-it-task-lists`（带 label，可显示复选框）。
- **Mermaid 图表**：```` ```mermaid ```` 代码块渲染为 SVG（流程图、时序图、类图、甘特图、ER 图、思维导图等）；解析失败会在预览中标记错误而不是崩溃。
- **锚点跳转**：标题自动生成唯一 slug id，点击文内 `[](#锚点)` 链接平滑滚动并闪烁提示。
- **外链处理**：非 `#` 开头的链接自动加 `target="_blank" rel="noopener noreferrer"`。
- **本地图片解析**：支持文档中相对路径引用的图片，按当前文件路径解析后以 `blob:` URL 加载（`file://` 场景亦兼容），并在重新渲染前回收旧 URL。
- 预览区右下角实时显示文档总字数（不计空白字符）。

### 2.4 大纲

- 解析 H1~H6 生成层级化大纲，标注 `H1~H6` 等级标记，随编辑实时更新。
- 点击大纲项：编辑器光标跳到对应行并闪烁高亮，同时预览区滚动到对应标题。
- 滚动预览时，大纲自动高亮当前所处章节，并保持激活项在可视区域内。

### 2.5 布局与视图

- 三种视图模式：**编辑 / 分屏 / 预览**，状态持久化。
- 左右侧栏可独立显示或隐藏。
- 左右面板支持拖拽调整宽度（左 180–500px，大纲 160–500px）。
- 编辑区与预览区**双向滚动同步**（按滚动比例同步）。

### 2.6 工具栏 / 文档区操作

- 打开文件夹、刷新目录树、左右侧栏开关。
- 字号调节：13–24px，按钮调节或直接输入。
- **保存**：保存按钮、`Ctrl/Cmd + S` 手动保存；保存状态条显示 已保存 / 保存中 / 有未保存修改 / 保存失败 等状态。
- **自动保存**：默认开启，编辑停止 650ms 后写回磁盘；写入串行排队，避免并发写冲突。自动保存开关位于设置面板；切换文件或目录前会先提示/自动保存未保存内容，页面关闭前 `beforeunload` 也会提醒。
- **自动刷新预览**：默认开启（防抖 180ms）；可在设置面板中开关并调整刷新间隔（1–60 秒，默认 3 秒），关闭后使用“刷新预览”手动刷新，便于编辑大文档时省性能。
- **复制纯文本**：把当前 Markdown 转成不含标记的纯文本写入系统剪贴板。
- **设置面板**：右上角齿轮按钮打开（按 Esc 或点击面板外区域关闭），包含主题色、自动保存、自动刷新与刷新间隔。
- **主题色**：青绿 / 靛蓝 / 紫罗兰 / 琥珀 / 玫红五种主题色，切换后立即生效并持久化；强调色与侧栏、按钮、边框、状态栏等中性底色均由主题色相统一推导，整套界面保持同色系。
- 状态栏：行数、词数、光标行列位置。

### 2.7 浏览器集成

- 点击扩展图标 → 直接打开 Markdown Studio 独立标签页。
- 用浏览器直接打开本地 `.md` 文件（file://）时，内容脚本 `open-md-file.js` 会把它交给 `background.js`，自动在编辑器中打开该文件（快照导入模式，提示“只读导入”；绑定文件夹后方可写回）。
- 权限最小化：仅申请 `storage` 与 `file:///*`，无 `<all_urls>`、无远程请求。

### 2.8 偏好持久化

布局相关偏好存于 `chrome.storage.local`，缺失时自动降级到 `localStorage`：视图模式、左右侧栏显隐、字号、主题色、自动保存、自动刷新预览、刷新间隔、历史目录折叠状态、上次打开文件路径、文档快照。

---

## 3. 构建与打包

### 3.1 命令速查

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 安装依赖 | `npm install` / `npm ci` | 有 `package-lock.json`，建议 CI 用 `npm ci` |
| 开发调试 | `npm run dev` | Vite 开发服务器，地址 http://127.0.0.1:5173 |
| 构建 | `npm run build` | 输出到 `dist/`，每次构建会清空该目录 |
| 预览构建产物 | `npm run preview` | 本地静态服务预览 `dist/` |
| **正式包（推荐）** | `build.bat` | 安装依赖（缺失时）→ 构建 → 校验 → 打 zip 到 `release/` |
| 正式包（跳过安装） | `build.bat --no-install` | 本机已装依赖时使用，等价于 `-NoInstall` |
| 清理产物 | `build.bat clean` | 删除 `dist/` 与 `release/` |
| 查看脚本帮助 | `build.bat help` | 输出用法与产物说明 |

打包完成后控制台会输出：

```
版本号  ：0.1.0
扩展目录：D:\...\markdown-studio\dist
压缩包  ：D:\...\markdown-studio\release\markdown-studio-0.1.0.zip  (1144 KB)
```

### 3.2 加载构建产物到浏览器

1. 执行 `build.bat`（或 `npm run build`）。
2. 打开 `chrome://extensions`，右上角开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**，选择项目根目录下的 `dist` 文件夹。
4. 点击工具栏扩展图标，或访问 `chrome-extension://<扩展ID>/editor.html` 打开编辑器。

> Edge 同理：`edge://extensions`。

### 3.3 发布到 Chrome Web Store

1. 确认版本号（见 3.4）。
2. 执行 `build.bat`，得到 `release/markdown-studio-<版本号>.zip`。
3. 在 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole) 上传该 zip。
4. 压缩包根目录直接包含 `manifest.json`（Vite 会把 `public/` 内容复制到 `dist/` 根目录），符合商店上传要求。

### 3.4 版本号

版本号分布在两处，升级时请**同时**修改保持一致：

- `package.json` → `version`（决定 zip 文件名）
- `public/manifest.json` → `version`（扩展自身版本）

---

## 4. 目录结构

```
markdown-studio/
├─ build.bat                 # Windows 正式包构建脚本
├─ editor.html               # Vite 入口：扩展主页面
├─ vite.config.js            # 构建配置（入口 editor.html，输出 dist）
├─ package.json
├─ public/                   # 原样复制到 dist 根目录
│  ├─ manifest.json          # Manifest V3 配置
│  ├─ background.js          # Service Worker：图标点击、接收文件内容
│  └─ open-md-file.js        # content script：接管本地 file:// 的 md 打开
├─ src/
│  ├─ main.js                # 应用主体（文件系统、编辑器、预览、大纲、UI）
│  ├─ outline.js             # 标题提取与 slug 生成
│  ├─ resource-paths.js      # 文档资源路径解析（相对路径 / file://）
│  └─ styles.css             # 全部样式
├─ dist/                     # 构建产物（gitignore）
├─ release/                  # 正式包 zip 输出目录（gitignore）
└─ design.md                 # 设计文档
```

主要源码模块对应关系：

| 模块 | 职责 |
| --- | --- |
| `PreferenceStore` | 偏好读写（chrome.storage.local，降级 localStorage） |
| `DirectoryHandleStore` | IndexedDB 持久化根目录句柄与历史目录 |
| `FileSystemModule` | 目录/文件的增删改查、权限校验、树构建与懒加载 |
| `TreeView` | 目录树渲染、展开折叠、高亮、右键菜单入口 |
| `EditorCore` | CodeMirror 6 实例、内容读写、跳转与行高亮 |
| `PreviewEngine` | markdown-it 渲染、任务列表、Mermaid、图片解析、锚点跳转 |
| `PlaintextPreviewEngine` | `.txt` 纯文本预览 |
| `OutlineManager` | 大纲生成、跳转、滚动高亮同步 |
| `EditorPreviewScrollSync` | 编辑区与预览区双向滚动同步 |
| `LayoutController` | 视图模式与侧栏显隐 |

---

## 5. 技术栈

| 层次 | 选型 |
| --- | --- |
| 编辑器 | CodeMirror 6（`codemirror`、`@codemirror/lang-markdown`、`state`、`view`、`commands`） |
| Markdown 渲染 | `markdown-it` + `markdown-it-task-lists` |
| 图表 | `mermaid` |
| 图标 | `lucide` |
| 文件访问 | File System Access API（`showDirectoryPicker` + `createWritable`） |
| 存储 | `chrome.storage.local`（降级 localStorage）、IndexedDB（目录句柄） |
| 构建 | Vite 7 |
| 扩展规范 | Manifest V3（Service Worker + content script） |

---

## 6. 已知事项与排错

- **仅支持 Chromium 内核**：Firefox / Safari 不支持 File System Access API，扩展会显示“当前浏览器不支持本地目录写入”的提示。
- **目录权限过期**：浏览器重启或长时间未使用后可能要求重新授权，重新打开目录并确认即可；历史目录若提示“需要重新授权”，删除后重选。
- **构建体积告警**：`npm run build` 会提示某些 chunk 大于 500 kB（`assets/editor-*.js` 约 1.3 MB，主要由 Mermaid 引起）。这是 Vite 的性能提示，不影响扩展运行；如需消除，可在 `vite.config.js` 调整 `build.chunkSizeWarningLimit` 或配置 `manualChunks`。
- **CSP 限制**：扩展页策略为 `script-src 'self'`，请勿引入内联脚本或外部 CDN 资源，否则会在 `chrome://extensions` 页面报 CSP 错误。
- **`build.bat` 报错“压缩失败”**：通常是上一版 zip 被资源管理器/压缩软件占用，先关闭占用程序，或执行 `build.bat clean` 后重试。
- **改了源码却不生效**：扩展页面有缓存，请在扩展卡片上点“重新加载”，重新执行 `build.bat` 生成新产物后再重载。
