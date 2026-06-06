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
