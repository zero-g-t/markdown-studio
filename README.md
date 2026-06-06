# Markdown Studio

基于 Manifest V3 的本地优先 Markdown 编辑器 Chrome 扩展。

## 功能

- 打开本地文件夹并递归读取 Markdown 文件
- 左侧目录树浏览、展开/折叠、当前文件高亮
- 右键新建文件、新建文件夹、重命名、删除
- CodeMirror 6 编辑器，支持行号、Markdown 语法高亮、撤销/重做和搜索
- markdown-it 实时预览，支持任务列表
- 自动提取 H1-H6 大纲并跳转到对应行
- 编辑、预览、分屏三种视图模式
- 自动保存和 `Ctrl+S` 手动保存
- 通过 `chrome.storage.local` 保存用户偏好

## 开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

构建产物会输出到 `dist/`。

## 在 Chrome 中加载

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择本项目的 `dist/` 目录

扩展安装后，点击工具栏里的扩展图标会打开 `editor.html`。

## 接管浏览器打开的 Markdown 文件

Chrome 不允许扩展直接注册成系统级 `.md` 默认打开程序。要让 Chrome 打开 `file://.../*.md` 时自动进入 Markdown Studio，需要：

1. 在 `chrome://extensions/` 找到 Markdown Studio
2. 点击“详细信息”
3. 开启“允许访问文件网址”
4. 用 Chrome 打开本地 `.md` 文件

这种入口读取到的是浏览器页面里的文件内容，属于只读导入。需要写回本地文件时，请在 Markdown Studio 里点击“打开文件夹”，通过 File System Access API 授权目录写入。
