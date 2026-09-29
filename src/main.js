import './styles.css';
import MarkdownIt from 'markdown-it';
import markdownItTaskLists from 'markdown-it-task-lists';
import mermaid from 'mermaid';
import { extractOutlineItems, inlineTokensToText, slugifyHeadingText } from './outline.js';
import { resolveFileResourceUrl, resolveWorkspaceResourcePath } from './resource-paths.js';
import { basicSetup, EditorView } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import {
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  Dot,
  Eye,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  createIcons
} from 'lucide';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd']);
const TXT_EXTENSION = new Set(['.txt']);
const AUTOSAVE_DELAY = 650;
const PREVIEW_DELAY = 180;
const EXTERNAL_CHANGE_CHECK_INTERVAL = 2500;
const EMPTY_DOCUMENT = '# Untitled\n\nStart writing Markdown here.\n';
const studioIcons = {
  ChevronDown,
  ChevronRight,
  Columns2,
  Copy,
  Dot,
  Eye,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2
};

function debounce(fn, wait) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function isMarkdownFile(name) {
  const lower = name.toLowerCase();
  return [...MARKDOWN_EXTENSIONS].some((extension) => lower.endsWith(extension));
}

function isTxtFile(name) {
  const lower = name.toLowerCase();
  return [...TXT_EXTENSION].some((extension) => lower.endsWith(extension));
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function htmlToPlainText(html) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  wrapper.querySelectorAll('br').forEach((node) => node.replaceWith('\n'));
  wrapper
    .querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,tr,table,ul,ol')
    .forEach((node) => node.append('\n'));

  return wrapper.textContent
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function countTotalCharacters(content) {
  return Array.from(content.replace(/\s/g, '')).length;
}

function formatDisplayPath(pathOrUrl) {
  if (!pathOrUrl) {
    return '';
  }

  try {
    if (pathOrUrl.startsWith('file://')) {
      const url = new URL(pathOrUrl);
      const decodedPath = decodeURIComponent(url.pathname);
      const windowsPath = decodedPath.replace(/^\/([A-Za-z]:)/, '$1').replaceAll('/', '\\');
      return windowsPath;
    }
    return decodeURIComponent(pathOrUrl);
  } catch {
    return pathOrUrl;
  }
}

function normalizeFileName(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('名称不能为空');
  }
  if (/[\\/]/.test(trimmed)) {
    throw new Error('名称不能包含路径分隔符');
  }
  return trimmed;
}

function renderIcons() {
  createIcons({ icons: studioIcons });
}

function getStorageArea() {
  if (globalThis.chrome?.storage?.local) {
    return chrome.storage.local;
  }

  return {
    async get(defaults) {
      const result = { ...defaults };
      for (const key of Object.keys(defaults)) {
        const raw = localStorage.getItem(`markdown-studio:${key}`);
        if (raw !== null) {
          result[key] = JSON.parse(raw);
        }
      }
      return result;
    },
    async set(values) {
      Object.entries(values).forEach(([key, value]) => {
        localStorage.setItem(`markdown-studio:${key}`, JSON.stringify(value));
      });
    }
  };
}

class PreferenceStore {
  constructor() {
    this.storage = getStorageArea();
    this.defaults = {
      viewMode: 'preview',
      leftSidebar: true,
      outlineSidebar: true,
      activePath: '',
      documentSnapshot: null,
      fontSize: 16,
      autosave: true,
      previewAutoRefresh: true,
      theme: 'light',
      historyCollapsed: false
    };
  }

  async load() {
    return this.storage.get(this.defaults);
  }

  async save(values) {
    await this.storage.set(values);
  }
}

class DirectoryHandleStore {
  constructor() {
    this.dbName = 'markdown-studio';
    this.storeName = 'handles';
    this.rootKey = 'root-directory';
    this.historyKey = 'directory-history';
    this.maxHistory = 10;
  }

  async openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this.storeName);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getRootHandle() {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).get(this.rootKey);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async setRootHandle(handle) {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const request = transaction.objectStore(this.storeName).put(handle, this.rootKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async getDirectoryHistory() {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const request = transaction.objectStore(this.storeName).get(this.historyKey);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async setDirectoryHistory(history) {
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const request = transaction.objectStore(this.storeName).put(history, this.historyKey);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async addDirectoryToHistory(handle) {
    const history = await this.getDirectoryHistory();
    const nextHistory = [
      {
        name: handle.name,
        handle,
        updatedAt: Date.now()
      },
      ...history.filter((item) => item.name !== handle.name)
    ].slice(0, this.maxHistory);
    await this.setDirectoryHistory(nextHistory);
    return nextHistory;
  }

  async deleteDirectoryHistoryItem(index) {
    const history = await this.getDirectoryHistory();
    const nextHistory = history.filter((_, itemIndex) => itemIndex !== index);
    await this.setDirectoryHistory(nextHistory);
    return nextHistory;
  }
}

class FileSystemModule {
  constructor() {
    this.rootHandle = null;
    this.handleStore = new DirectoryHandleStore();
  }

  isSupported() {
    return 'showDirectoryPicker' in window;
  }

  async pickDirectory(options = {}) {
    if (!this.isSupported()) {
      throw new Error('当前浏览器不支持 File System Access API，请在最新版 Chrome 或 Edge 中使用。');
    }

    this.rootHandle = await window.showDirectoryPicker({
      id: options.id || 'markdown-studio-root',
      mode: 'readwrite'
    });
    await this.handleStore.setRootHandle(this.rootHandle);
    await this.handleStore.addDirectoryToHistory(this.rootHandle);
    return this.buildTree(this.rootHandle, '', null, true);
  }

  async restoreDirectory() {
    const handle = await this.handleStore.getRootHandle();
    if (!handle) {
      return null;
    }

    return this.openDirectoryHandle(handle);
  }

  async openDirectoryHandle(handle) {
    const hasPermission = await this.verifyPermission(handle);
    if (!hasPermission) {
      return null;
    }

    this.rootHandle = handle;
    await this.handleStore.setRootHandle(handle);
    await this.handleStore.addDirectoryToHistory(handle);
    return this.buildTree(this.rootHandle, '', null, true);
  }

  async getDirectoryHistory() {
    return this.handleStore.getDirectoryHistory();
  }

  async deleteDirectoryHistoryItem(index) {
    return this.handleStore.deleteDirectoryHistoryItem(index);
  }

  async verifyPermission(handle) {
    const options = { mode: 'readwrite' };
    if ((await handle.queryPermission(options)) === 'granted') {
      return true;
    }

    try {
      return (await handle.requestPermission(options)) === 'granted';
    } catch {
      return false;
    }
  }

  async buildTree(handle = this.rootHandle, path = '', parentHandle = null, isOpen = false) {
    const node = {
      name: handle.name,
      path: path || '/',
      type: 'directory',
      handle,
      parentHandle,
      children: [],
      isLoaded: false,
      isOpen
    };

    await this.loadChildren(node);
    return node;
  }

  async loadChildren(node) {
    if (!node || node.type !== 'directory' || node.isLoaded) {
      return node;
    }

    const children = [];
    const basePath = node.path === '/' ? '' : node.path;

    for await (const [name, childHandle] of node.handle.entries()) {
      const childPath = `${basePath}/${name}`;
      if (childHandle.kind === 'directory') {
        children.push({
          name,
          path: childPath,
          type: 'directory',
          handle: childHandle,
          parentHandle: node.handle,
          children: [],
          isLoaded: false,
          isOpen: false
        });
      } else if (isMarkdownFile(name) || isTxtFile(name)) {
        children.push({
          name,
          path: childPath,
          type: 'file',
          handle: childHandle,
          parentHandle: node.handle,
          isTxt: isTxtFile(name)
        });
      }
    }

    children.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true });
    });

    node.children = children;
    node.isLoaded = true;
    return node;
  }

  async loadPath(root, path) {
    if (!root || !path || path === '/') {
      return root || null;
    }

    const parts = path.split('/').filter(Boolean);
    let current = root;
    await this.loadChildren(current);

    for (const part of parts) {
      const child = current.children.find((item) => item.name === part);
      if (!child) {
        return null;
      }
      if (child.path === path) {
        return child;
      }
      if (child.type !== 'directory') {
        return null;
      }
      child.isOpen = true;
      current = child;
      await this.loadChildren(current);
    }

    return current;
  }

  async refreshTree() {
    if (!this.rootHandle) {
      return null;
    }
    return this.buildTree(this.rootHandle, '', null, true);
  }

  async readFile(handle) {
    const file = await handle.getFile();
    return file.text();
  }

  async readFileByPathParts(parts) {
    if (!this.rootHandle || !Array.isArray(parts) || !parts.length) {
      return null;
    }

    try {
      let directoryHandle = this.rootHandle;
      for (const part of parts.slice(0, -1)) {
        directoryHandle = await directoryHandle.getDirectoryHandle(part);
      }

      const fileHandle = await directoryHandle.getFileHandle(parts.at(-1));
      return fileHandle.getFile();
    } catch (error) {
      if (['NotFoundError', 'TypeMismatchError'].includes(error.name)) {
        return null;
      }
      throw error;
    }
  }

  async writeFile(handle, content) {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async createFile(parentHandle, name) {
    const fileName = normalizeFileName(name.endsWith('.md') ? name : `${name}.md`);
    await this.assertNameAvailable(parentHandle, fileName);
    const handle = await parentHandle.getFileHandle(fileName, { create: true });
    await this.writeFile(handle, EMPTY_DOCUMENT);
    return handle;
  }

  async createDirectory(parentHandle, name) {
    const directoryName = normalizeFileName(name);
    await this.assertNameAvailable(parentHandle, directoryName);
    return parentHandle.getDirectoryHandle(directoryName, { create: true });
  }

  async deleteEntry(node) {
    if (!node.parentHandle) {
      throw new Error('不能删除当前打开的根目录');
    }
    await node.parentHandle.removeEntry(node.name, { recursive: true });
  }

  async renameEntry(node, nextName) {
    const name = normalizeFileName(nextName);
    if (!node.parentHandle || node.name === name) {
      return;
    }
    await this.assertNameAvailable(node.parentHandle, name);

    if (node.type === 'file') {
      const content = await this.readFile(node.handle);
      const nextHandle = await node.parentHandle.getFileHandle(name, { create: true });
      await this.writeFile(nextHandle, content);
      await node.parentHandle.removeEntry(node.name);
      return;
    }

    const nextHandle = await node.parentHandle.getDirectoryHandle(name, { create: true });
    await this.copyDirectory(node.handle, nextHandle);
    await node.parentHandle.removeEntry(node.name, { recursive: true });
  }

  async assertNameAvailable(parentHandle, name) {
    for (const getter of ['getFileHandle', 'getDirectoryHandle']) {
      try {
        await parentHandle[getter](name);
        throw new Error(`已存在同名项目：${name}`);
      } catch (error) {
        if (error.name !== 'NotFoundError') {
          throw error;
        }
      }
    }
  }

  async copyDirectory(sourceHandle, targetHandle) {
    for await (const [name, handle] of sourceHandle.entries()) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const targetFile = await targetHandle.getFileHandle(name, { create: true });
        await this.writeFile(targetFile, await file.text());
      } else {
        const childTarget = await targetHandle.getDirectoryHandle(name, { create: true });
        await this.copyDirectory(handle, childTarget);
      }
    }
  }
}

const setLineHighlight = StateEffect.define();

const lineHighlightField = StateField.define({
  create() {
    return Decoration.none;
  },
  update(highlights, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setLineHighlight)) {
        if (!effect.value) {
          return Decoration.none;
        }
        const line = transaction.state.doc.line(effect.value);
        return Decoration.set([
          Decoration.line({ class: 'cm-flash-line' }).range(line.from)
        ]);
      }
    }
    return highlights.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field)
});

class EditorCore {
  constructor(parent) {
    this.parent = parent;
    this.callbacks = new Set();
    this.cursorCallbacks = new Set();
    this.settingContent = false;
    this.highlightTimer = 0;
    this.extensions = [
      basicSetup,
      markdown(),
      lineHighlightField,
      keymap.of([indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !this.settingContent) {
          const content = this.getContent();
          this.callbacks.forEach((callback) => callback(content));
        }
        if (update.docChanged || update.selectionSet) {
          this.emitCursor();
        }
      })
    ];

    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: '', extensions: this.extensions })
    });
  }

  // 整体替换文档（打开文件、从磁盘重新加载）时重建编辑器状态，撤销历史不会跨越两个文档
  setContent(text) {
    const { scrollTop, scrollLeft } = this.view.scrollDOM;
    this.settingContent = true;
    this.view.setState(EditorState.create({ doc: text, extensions: this.extensions }));
    this.settingContent = false;
    this.view.scrollDOM.scrollTop = scrollTop;
    this.view.scrollDOM.scrollLeft = scrollLeft;
    this.emitCursor();
  }

  resetScroll() {
    this.view.dispatch({
      selection: { anchor: 0 },
      scrollIntoView: true,
      effects: setLineHighlight.of(null)
    });
    this.view.scrollDOM.scrollTop = 0;
    this.view.scrollDOM.scrollLeft = 0;
  }

  getContent() {
    return this.view.state.doc.toString();
  }

  focus() {
    this.view.focus();
  }

  goToLine(lineNumber) {
    const boundedLine = Math.max(1, Math.min(lineNumber, this.view.state.doc.lines));
    const line = this.view.state.doc.line(boundedLine);
    this.view.dispatch({
      selection: { anchor: line.from },
      scrollIntoView: true,
      effects: setLineHighlight.of(boundedLine)
    });
    this.focus();

    clearTimeout(this.highlightTimer);
    this.highlightTimer = window.setTimeout(() => {
      this.view.dispatch({ effects: setLineHighlight.of(null) });
    }, 1200);
  }

  onChange(callback) {
    this.callbacks.add(callback);
  }

  onCursor(callback) {
    this.cursorCallbacks.add(callback);
  }

  emitCursor() {
    const selection = this.view.state.selection.main;
    const line = this.view.state.doc.lineAt(selection.head);
    const column = selection.head - line.from + 1;
    this.cursorCallbacks.forEach((callback) => callback({
      line: line.number,
      column,
      lines: this.view.state.doc.lines
    }));
  }
}

class PreviewEngine {
  constructor(container, options = {}) {
    this.container = container;
    this.resolveImageSource = options.resolveImageSource || null;
    this.imageObjectUrls = new Set();
    this.headingIds = new Set();
    this.renderVersion = 0;
    this.md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: true
    }).use(markdownItTaskLists, {
      enabled: true,
      label: true,
      labelAfter: true
    });

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default'
    });

    const originalFence = this.md.renderer.rules.fence || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    this.md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const language = token.info.trim().split(/\s+/)[0].toLowerCase();
      if (language === 'mermaid') {
        return `<div class="mermaid-diagram"><pre class="mermaid-source">${escapeHtml(token.content)}</pre></div>`;
      }
      return originalFence(tokens, idx, options, env, self);
    };

    const originalLinkOpen = this.md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    this.md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const href = token.attrGet('href') || '';
      if (!href.startsWith('#')) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      }
      return originalLinkOpen(tokens, idx, options, env, self);
    };

    const originalHeadingOpen = this.md.renderer.rules.heading_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    this.md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const lineNumber = token.map?.[0] + 1;
      if (lineNumber) {
        token.attrSet('data-source-line', String(lineNumber));
        token.attrJoin('class', 'preview-heading');
      }
      const inlineToken = tokens[idx + 1];
      if (inlineToken?.type === 'inline') {
        const text = inlineTokensToText(inlineToken.children || [inlineToken]).trim();
        if (text) {
          token.attrSet('id', this.getUniqueHeadingId(text));
        }
      }
      return originalHeadingOpen(tokens, idx, options, env, self);
    };

    this.container.addEventListener('click', (event) => {
      const link = event.target?.closest?.('a[href^="#"]');
      if (!link) {
        return;
      }
      if (this.scrollToHashLink(link.getAttribute('href'))) {
        event.preventDefault();
      }
    });
  }

  render(markdownSource) {
    const renderVersion = ++this.renderVersion;
    this.revokeImageObjectUrls();

    if (!markdownSource.trim()) {
      this.container.innerHTML = '<div class="empty-state compact">预览区暂无内容</div>';
      return;
    }

    this.headingIds.clear();
    this.container.innerHTML = this.md.render(markdownSource);
    this.resolveImageSources(renderVersion);
    this.renderMermaidDiagrams();
  }

  revokeImageObjectUrls() {
    this.imageObjectUrls.forEach((url) => URL.revokeObjectURL(url));
    this.imageObjectUrls.clear();
  }

  async resolveImageSources(renderVersion) {
    if (!this.resolveImageSource) {
      return;
    }

    const images = Array.from(this.container.querySelectorAll('img[src]'));
    await Promise.all(images.map(async (image) => {
      const originalSource = image.getAttribute('src');
      if (!originalSource) {
        return;
      }

      try {
        const resolvedSource = await this.resolveImageSource(originalSource);
        if (!resolvedSource) {
          return;
        }

        if (this.renderVersion !== renderVersion || !image.isConnected) {
          if (resolvedSource.startsWith('blob:')) {
            URL.revokeObjectURL(resolvedSource);
          }
          return;
        }

        image.setAttribute('src', resolvedSource);
        if (resolvedSource.startsWith('blob:')) {
          this.imageObjectUrls.add(resolvedSource);
        }
      } catch (error) {
        console.warn('Failed to resolve preview image', originalSource, error);
      }
    }));
  }

  async renderMermaidDiagrams() {
    const sources = Array.from(this.container.querySelectorAll('.mermaid-source'));
    if (!sources.length) {
      return;
    }

    await Promise.all(sources.map(async (source, index) => {
      const diagramSource = source.textContent || '';
      const wrapper = source.closest('.mermaid-diagram');
      if (!wrapper) {
        return;
      }

      try {
        const id = `mermaid-${Date.now()}-${index}`;
        const { svg, bindFunctions } = await mermaid.render(id, diagramSource);
        if (source.isConnected) {
          wrapper.innerHTML = svg;
          bindFunctions?.(wrapper);
        }
      } catch (error) {
        console.warn('Failed to render Mermaid diagram', error);
        if (source.isConnected) {
          source.classList.add('mermaid-error');
        }
      }
    }));
  }

  getUniqueHeadingId(text) {
    const base = slugifyHeadingText(text) || 'section';
    let id = base;
    let counter = 1;
    while (this.headingIds.has(id)) {
      id = `${base}-${counter++}`;
    }
    this.headingIds.add(id);
    return id;
  }

  scrollToHashLink(rawHash) {
    if (!rawHash?.startsWith('#')) {
      return false;
    }

    let id = rawHash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // Keep the raw value when the hash contains malformed percent escapes.
    }

    const target = Array.from(this.container.querySelectorAll('[id]'))
      .find((element) => element.id === id);
    if (!target) {
      return false;
    }

    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    target.classList.add('preview-heading-flash');
    window.setTimeout(() => target.classList.remove('preview-heading-flash'), 1200);
    try {
      window.history.replaceState(null, '', rawHash);
    } catch {
      // Some file/extension contexts disallow history updates; scrolling still works.
    }
    return true;
  }

  toPlainText(markdownSource) {
    if (!markdownSource.trim()) {
      return '';
    }
    return htmlToPlainText(this.md.render(markdownSource));
  }

  scrollToLine(lineNumber) {
    const target = this.container.querySelector(`[data-source-line="${lineNumber}"]`);
    if (!target) {
      return;
    }

    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    target.classList.add('preview-heading-flash');
    window.setTimeout(() => target.classList.remove('preview-heading-flash'), 1200);
  }

  resetScroll() {
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
  }
}

class PlaintextPreviewEngine {
  constructor(container) {
    this.container = container;
  }

  render(text) {
    if (!text.trim()) {
      this.container.innerHTML = '<div class="empty-state compact">预览区暂无内容</div>';
      return;
    }
    // Escape HTML and wrap in pre to preserve whitespace/line breaks
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
    this.container.innerHTML = `<article style="background:#fff;overflow:auto;height:100%;padding:22px 28px 42px;color:#24292f;font-size:var(--content-font-size);line-height:1.65;white-space:pre-wrap;word-wrap:break-word;">${escaped}</article>`;
  }

  resetScroll() {
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
  }
}

class OutlineManager {
  constructor(container, editor, preview) {
    this.container = container;
    this.editor = editor;
    this.preview = preview;
    this.items = [];
    this.activeIndex = -1;
    this.onScrollUpdate = null;
  }

  update(markdownSource) {
    this.items = this.extract(markdownSource);
    this.render();
  }

  extract(markdownSource) {
    return extractOutlineItems(markdownSource);
  }

  render() {
    if (!this.items.length) {
      this.activeIndex = -1;
      this.container.innerHTML = '<div class="empty-state compact">没有可用标题</div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    const list = document.createElement('ol');
    list.className = 'outline-list';

    this.items.forEach((item, index) => {
      const entry = document.createElement('li');
      entry.style.setProperty('--level', item.level);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'outline-item';
      button.dataset.index = index;
      button.title = `跳转到第 ${item.lineNumber} 行`;
      button.innerHTML = `
        <span class="outline-marker">H${item.level}</span>
        <span class="outline-title">${escapeHtml(item.text)}</span>
      `;
      button.addEventListener('click', () => {
        this.editor.goToLine(item.lineNumber);
        this.preview.scrollToLine(item.lineNumber);
      });
      entry.append(button);
      list.append(entry);
    });

    fragment.append(list);
    this.container.replaceChildren(fragment);
    this.activeIndex = -1;
    this.highlightActive(0);
  }

  resetScroll() {
    this.container.scrollTop = 0;
    this.container.scrollLeft = 0;
  }

  highlightActive(activeIndex) {
    if (activeIndex === this.activeIndex) return;
    this.activeIndex = activeIndex;

    this.container.querySelectorAll('.outline-item').forEach((item, i) => {
      item.classList.toggle('active', i === activeIndex);
    });

    // Auto-scroll outline container to keep active item visible
    if (activeIndex >= 0) {
      const activeEl = this.container.querySelector(`.outline-item[data-index="${activeIndex}"]`);
      if (activeEl) {
        const container = this.container.querySelector('.outline-host') || this.container;
        const containerRect = container.getBoundingClientRect();
        const itemRect = activeEl.getBoundingClientRect();
        if (itemRect.top < containerRect.top + 42 || itemRect.bottom > containerRect.bottom) {
          activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
    }
  }

  setupScrollSync() {
    const previewContainer = this.preview.container;
    if (!previewContainer) return;

    this.onScrollUpdate = () => {
      if (!this.items.length) return;

      const scrollTop = previewContainer.scrollTop;
      const maxScrollTop = previewContainer.scrollHeight - previewContainer.clientHeight;
      const headingElements = previewContainer.querySelectorAll('.preview-heading');

      if (scrollTop >= maxScrollTop - 2) {
        this.highlightActive(this.items.length - 1);
        return;
      }

      let activeIndex = -1;
      for (let i = headingElements.length - 1; i >= 0; i--) {
        const el = headingElements[i];
        if (el.offsetTop <= scrollTop + 20) {
          // Find the matching outline item by lineNumber
          const sourceLine = Number(el.getAttribute('data-source-line'));
          const matchIndex = this.items.findIndex((item) => item.lineNumber === sourceLine);
          if (matchIndex !== -1) {
            activeIndex = matchIndex;
            break;
          }
        }
      }

      if (activeIndex >= 0) {
        this.highlightActive(activeIndex);
      }
    };

    previewContainer.addEventListener('scroll', this.onScrollUpdate, { passive: true });

    // Also sync when editor scroll changes (update preview scroll)
    // and when outline item is clicked (update outline highlight)
  }

  destroyScrollSync() {
    const previewContainer = this.preview.container;
    if (previewContainer && this.onScrollUpdate) {
      previewContainer.removeEventListener('scroll', this.onScrollUpdate);
      this.onScrollUpdate = null;
    }
  }
}

class EditorPreviewScrollSync {
  constructor(editor, preview) {
    this.editor = editor;
    this.preview = preview;
    this.syncing = false;
    this.onEditorScroll = () => this.syncFrom(this.editor.view.scrollDOM, this.preview.container);
    this.onPreviewScroll = () => this.syncFrom(this.preview.container, this.editor.view.scrollDOM);
  }

  setup() {
    this.editor.view.scrollDOM.addEventListener('scroll', this.onEditorScroll, { passive: true });
    this.preview.container.addEventListener('scroll', this.onPreviewScroll, { passive: true });
  }

  syncFrom(source, target) {
    if (this.syncing || !source || !target) {
      return;
    }

    const sourceMax = source.scrollHeight - source.clientHeight;
    const targetMax = target.scrollHeight - target.clientHeight;
    if (sourceMax <= 0 || targetMax <= 0) {
      return;
    }

    const ratio = source.scrollTop / sourceMax;
    this.syncing = true;
    target.scrollTop = ratio * targetMax;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        this.syncing = false;
      });
    });
  }
}

class TreeView {
  constructor(container, callbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.root = null;
    this.activePath = '';
    this.openPaths = new Set(['/']);
  }

  setRoot(root) {
    this.root = root;
    this.openPaths = new Set();
    this.collectOpenPaths(root);
    this.render();
  }

  setActivePath(path) {
    this.activePath = path;
    this.render();
  }

  collectOpenPaths(node) {
    if (!node || node.type !== 'directory') {
      return;
    }
    if (node.isOpen) {
      this.openPaths.add(node.path);
    }
    node.children?.forEach((child) => this.collectOpenPaths(child));
  }

  render() {
    if (!this.root) {
      this.container.innerHTML = '<div class="empty-state">打开一个文件夹后会显示 Markdown 文件树</div>';
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'tree-root';
    wrapper.append(this.renderNode(this.root, 0));
    this.container.replaceChildren(wrapper);
    renderIcons();
  }

  renderNode(node, depth) {
    const item = document.createElement('div');
    item.className = `tree-node ${node.type}`;
    item.dataset.path = node.path;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tree-row';
    button.style.setProperty('--depth', depth);
    button.title = node.path;

    if (node.path === this.activePath) {
      button.classList.add('active');
    }

    const isDirectory = node.type === 'directory';
    const isOpen = this.openPaths.has(node.path);
    const isTxt = node.isTxt;
    const iconName = isDirectory ? (isOpen ? 'folder-open' : 'folder') : (isTxt ? 'file-text' : 'file-text');

    button.innerHTML = `
      <i class="tree-chevron" data-lucide="${isDirectory ? (isOpen ? 'chevron-down' : 'chevron-right') : 'dot'}"></i>
      <i class="tree-icon" data-lucide="${iconName}"></i>
      <span class="tree-label">${escapeHtml(node.name)}</span>
    `;

    button.addEventListener('click', () => {
      if (isDirectory) {
        this.callbacks.onToggleDirectory(node);
      } else {
        this.callbacks.onOpenFile(node);
      }
    });

    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.callbacks.onContextMenu(event, node);
    });

    item.append(button);

    if (isDirectory && isOpen && node.children?.length) {
      const children = document.createElement('div');
      children.className = 'tree-children';
      node.children.forEach((child) => children.append(this.renderNode(child, depth + 1)));
      item.append(children);
    }

    return item;
  }
}

class LayoutController {
  constructor(appElement) {
    this.appElement = appElement;
    this.mode = 'split';
    this.leftSidebar = true;
    this.outlineSidebar = true;
  }

  setMode(mode) {
    this.mode = mode;
    this.appElement.dataset.viewMode = mode;
    document.querySelectorAll('[data-mode]').forEach((button) => {
      button.classList.toggle('active', button.dataset.mode === mode);
      button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    });
  }

  setSidebar(sidebar, visible) {
    if (sidebar === 'left') {
      this.leftSidebar = visible;
      this.appElement.dataset.leftSidebar = visible ? 'visible' : 'hidden';
    }
    if (sidebar === 'outline') {
      this.outlineSidebar = visible;
      this.appElement.dataset.outlineSidebar = visible ? 'visible' : 'hidden';
    }

    document.querySelectorAll('[data-sidebar]').forEach((button) => {
      const isActive =
        (button.dataset.sidebar === 'left' && this.leftSidebar) ||
        (button.dataset.sidebar === 'outline' && this.outlineSidebar);
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }
}

class MarkdownStudioApp {
  constructor(root) {
    this.root = root;
    this.preferences = new PreferenceStore();
    this.fs = new FileSystemModule();
    this.currentFile = null;
    this.importedFile = null;
    this.snapshotFile = null;
    this.currentTree = null;
    this.lastSavedContent = '';
    this.dirty = false;
    this.autosave = true;
    this.previewAutoRefresh = true;
    this.saveQueue = Promise.resolve();
    this.currentFileIsTxt = false;
    this.directoryHistory = [];
    this.historyCollapsed = false;
    this.plaintextPreview = null;
    this.lastExternalCheckAt = 0;
    this.refreshPreview = debounce(() => {
      if (this.previewAutoRefresh) {
        this.renderCurrentPreview();
      }
    }, PREVIEW_DELAY);
    this.queueAutosave = debounce(() => this.saveCurrentFile('auto'), AUTOSAVE_DELAY);
    this.queueSnapshotSave = debounce(() => {
      this.persistDocumentSnapshot().catch((error) => console.warn('Failed to persist document snapshot', error));
    }, 300);

    this.renderShell();
  }

  async init() {
    const prefs = await this.preferences.load();
    this.autosave = Boolean(prefs.autosave);
    this.previewAutoRefresh = prefs.previewAutoRefresh !== false;
    this.historyCollapsed = Boolean(prefs.historyCollapsed);
    this.layout = new LayoutController(this.root.querySelector('.studio-shell'));
    this.editor = new EditorCore(this.root.querySelector('#editorHost'));
    this.preview = new PreviewEngine(this.root.querySelector('#previewHost'), {
      resolveImageSource: (source) => this.resolvePreviewImageSource(source)
    });
    this.outline = new OutlineManager(this.root.querySelector('#outlineHost'), this.editor, this.preview);
    this.scrollSync = new EditorPreviewScrollSync(this.editor, this.preview);
    this.tree = new TreeView(this.root.querySelector('#treeHost'), {
      onOpenFile: (node) => this.openFile(node),
      onToggleDirectory: (node) => this.toggleDirectory(node),
      onContextMenu: (event, node) => this.openContextMenu(event, node)
    });

    this.plaintextPreview = new PlaintextPreviewEngine(this.root.querySelector('#previewHost'));
    this.bindEvents();
    this.outline.setupScrollSync();
    this.scrollSync.setup();
    this.layout.setMode(prefs.viewMode || 'preview');
    this.layout.setSidebar('left', prefs.leftSidebar !== false);
    this.layout.setSidebar('outline', prefs.outlineSidebar !== false);
    this.setFontSize(prefs.fontSize || 16, false);
    this.setAutosave(this.autosave, false);
    this.setPreviewAutoRefresh(this.previewAutoRefresh, false);
    const importedFile = await this.consumeImportedFile();
    if (importedFile) {
      this.loadImportedFile(importedFile);
    } else {
      if (prefs.documentSnapshot) {
        this.loadDocumentSnapshot(prefs.documentSnapshot);
      } else {
        this.editor.setContent(EMPTY_DOCUMENT);
        this.preview.render(EMPTY_DOCUMENT);
        this.outline.update(EMPTY_DOCUMENT);
        this.setSaveStatus('idle', '未打开文件');
      }
      await this.restorePreviousDirectory(prefs.activePath);
    }
    await this.loadDirectoryHistory();
    this.updateFileTitle();
    this.updateStats();
    this.setSupportNotice();
    renderIcons();
  }

  renderShell() {
    this.root.innerHTML = `
      <main class="studio-shell" data-view-mode="split">
        <header class="toolbar">
          <div class="toolbar-group">
            <button id="openFolderButton" class="tool-button primary" type="button" title="打开本地文件夹">
              <i data-lucide="folder-open"></i>
              <span>打开文件夹</span>
            </button>
            <button id="refreshButton" class="icon-button" type="button" title="刷新目录树">
              <i data-lucide="refresh-cw"></i>
            </button>
            <button data-sidebar="left" class="icon-button active" type="button" title="显示或隐藏左侧文件目录">
              <i data-lucide="panel-left-close"></i>
            </button>
            <button data-sidebar="outline" class="icon-button active" type="button" title="显示或隐藏右侧大纲">
              <i data-lucide="panel-right-close"></i>
            </button>
          </div>
          <div class="segmented-control" aria-label="视图模式">
            <button data-mode="edit" type="button" title="仅编辑">
              <i data-lucide="panel-left-open"></i>
              <span>编辑</span>
            </button>
            <button data-mode="split" type="button" title="分屏编辑和预览">
              <i data-lucide="columns-2"></i>
              <span>分屏</span>
            </button>
            <button data-mode="preview" type="button" title="仅预览">
              <i data-lucide="eye"></i>
              <span>预览</span>
            </button>
          </div>
          <div class="font-size-control" aria-label="字号">
            <button id="decreaseFontButton" class="icon-button" type="button" title="减小字号">
              <i data-lucide="minus"></i>
            </button>
            <input id="fontSizeInput" type="number" min="13" max="24" step="1" title="字号" />
            <button id="increaseFontButton" class="icon-button" type="button" title="增大字号">
              <i data-lucide="plus"></i>
            </button>
          </div>
          <div class="toolbar-group push">
            <label class="toggle" title="内容变更后自动写回当前文件">
              <input id="autosaveToggle" type="checkbox" />
              <span>自动保存</span>
            </label>
            <button id="saveButton" class="icon-button" type="button" title="保存当前文件">
              <i data-lucide="save"></i>
            </button>
            <div id="saveStatus" class="save-status idle" aria-live="polite">未打开文件</div>
          </div>
        </header>

        <section class="workspace">
          <aside class="sidebar" id="leftSidebar">
            <div class="panel-header">
              <h2>文件</h2>
              <button id="newRootFileButton" class="icon-button small" type="button" title="在根目录新建 Markdown 文件">
                <i data-lucide="file-plus"></i>
              </button>
            </div>
            <div id="supportNotice" class="support-notice"></div>
            <section id="historySection" class="history-section" aria-label="历史打开目录">
              <button id="historyToggleButton" class="history-toggle" type="button" title="展开或折叠历史目录" aria-expanded="true">
                <i data-lucide="chevron-down"></i>
                <span>历史目录</span>
              </button>
              <div id="historyHost" class="history-host"></div>
            </section>
            <div id="treeHost" class="tree-host"></div>
          </aside>
          <div class="resize-handle sidebar-resize-handle" id="leftResizeHandle" title="拖动调整左侧面板宽度"></div>

          <section class="main-pane">
            <div class="document-bar">
              <div>
                <h1 id="fileTitle">未命名文档</h1>
                <p id="filePath">选择文件夹后打开 Markdown 文件</p>
              </div>
              <div class="document-actions">
                <button id="manualPreviewRefreshButton" class="tool-button document-action" type="button" title="重新读取磁盘文件并刷新预览">
                  <i data-lucide="refresh-cw"></i>
                  <span>刷新预览</span>
                </button>
                <label class="toggle preview-refresh-toggle" title="编辑内容变更或文件被外部修改后自动刷新预览">
                  <input id="previewAutoRefreshToggle" type="checkbox" />
                  <span>自动刷新</span>
                </label>
                <button id="copyPlainTextButton" class="tool-button document-action" type="button" title="复制不带 Markdown 标记的纯文本">
                  <i data-lucide="copy"></i>
                  <span>复制纯文本</span>
                </button>
              </div>
            </div>
            <div class="editor-preview">
              <section class="editor-pane" aria-label="Markdown 编辑器">
                <div id="editorHost" class="editor-host"></div>
              </section>
              <section class="preview-pane" aria-label="Markdown 预览">
                <article id="previewHost" class="markdown-body"></article>
                <div id="previewWordCount" class="preview-word-count" aria-live="polite">总字数：0</div>
              </section>
            </div>
          </section>

          <div class="resize-handle outline-resize-handle" id="outlineResizeHandle" title="拖动调整大纲面板宽度"></div>
          <aside class="outline-pane" id="outlinePane">
            <div class="panel-header">
              <h2>大纲</h2>
            </div>
            <div id="outlineHost" class="outline-host"></div>
          </aside>
        </section>

        <footer class="status-bar">
          <span id="statLines">Lines: 0</span>
          <span id="statWords">Words: 0</span>
          <span id="statCursor">Cursor: 1:1</span>
        </footer>
      </main>
      <div id="contextMenu" class="context-menu" hidden></div>
    `;
  }

  bindEvents() {
    this.root.querySelector('#openFolderButton').addEventListener('click', () => this.openDirectory());
    this.root.querySelector('#refreshButton').addEventListener('click', () => this.refreshDirectory());
    this.root.querySelector('#saveButton').addEventListener('click', () => this.saveCurrentFile('manual'));
    this.root.querySelector('#newRootFileButton').addEventListener('click', () => this.createInRoot('file'));
    this.root.querySelector('#manualPreviewRefreshButton').addEventListener('click', () => this.refreshDocumentView({ interactive: true }));
    this.root.querySelector('#copyPlainTextButton').addEventListener('click', () => this.copyPlainText());
    this.root.querySelector('#historyToggleButton').addEventListener('click', () => this.toggleDirectoryHistory());
    this.root.querySelector('#decreaseFontButton').addEventListener('click', () => this.adjustFontSize(-1));
    this.root.querySelector('#increaseFontButton').addEventListener('click', () => this.adjustFontSize(1));
    this.root.querySelector('#fontSizeInput').addEventListener('change', (event) => {
      this.setFontSize(Number(event.target.value));
    });

    this.root.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', async () => {
        this.layout.setMode(button.dataset.mode);
        await this.preferences.save({ viewMode: button.dataset.mode });
      });
    });

    this.root.querySelectorAll('[data-sidebar]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.dataset.sidebar === 'left') {
          const visible = !this.layout.leftSidebar;
          this.layout.setSidebar('left', visible);
          await this.preferences.save({ leftSidebar: visible });
        }
        if (button.dataset.sidebar === 'outline') {
          const visible = !this.layout.outlineSidebar;
          this.layout.setSidebar('outline', visible);
          await this.preferences.save({ outlineSidebar: visible });
        }
      });
    });

    this.root.querySelector('#autosaveToggle').addEventListener('change', async (event) => {
      this.setAutosave(event.target.checked);
      await this.preferences.save({ autosave: event.target.checked });
    });

    this.root.querySelector('#previewAutoRefreshToggle').addEventListener('change', async (event) => {
      this.setPreviewAutoRefresh(event.target.checked);
      await this.preferences.save({ previewAutoRefresh: event.target.checked });
      if (event.target.checked) {
        this.renderCurrentPreview();
      }
    });

    this.editor.onChange((content) => {
      this.dirty = content !== this.lastSavedContent;
      const dirtyText = this.importedFile
        ? '只读修改未保存'
        : (this.snapshotFile ? '快照修改未保存' : '有未保存修改');
      const savedText = this.importedFile
        ? '只读导入'
        : (this.snapshotFile ? '等待恢复文件' : '已保存');
      this.setSaveStatus(this.dirty ? 'dirty' : 'saved', this.dirty ? dirtyText : savedText);
      if (this.previewAutoRefresh) {
        this.refreshPreview();
      }
      this.updateStats();
      this.queueSnapshotSave();
      if (this.autosave && this.currentFile) {
        this.queueAutosave();
      }
    });

    this.editor.onCursor(() => this.updateStats());

    document.addEventListener('click', () => this.closeContextMenu());
    document.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        this.saveCurrentFile('manual');
      }
      if (event.key === 'Escape') {
        this.closeContextMenu();
      }
    });

    window.addEventListener('beforeunload', (event) => {
      if (this.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    window.addEventListener('focus', () => this.checkExternalChanges());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkExternalChanges();
      }
    });
    window.setInterval(
      () => this.checkExternalChanges({ requireFileHandle: true }),
      EXTERNAL_CHANGE_CHECK_INTERVAL
    );

    this.setupResizeHandle('leftResizeHandle', 'leftSidebar', 180, 500, 'left');
    this.setupResizeHandle('outlineResizeHandle', 'outlinePane', 160, 500, 'right');
  }

  setupResizeHandle(handleId, targetId, minWidth, maxWidth, side = 'left') {
    const handle = this.root.querySelector(`#${handleId}`);
    const target = this.root.querySelector(`#${targetId}`);
    if (!handle || !target) return;

    let isDragging = false;
    let startX = 0;
    let startWidth = 0;
    let rightEdge = 0;

    const onPointerMove = (event) => {
      if (!isDragging) return;
      event.preventDefault();
      let newWidth;
      if (side === 'right') {
        newWidth = rightEdge - event.clientX;
      } else {
        const delta = event.clientX - startX;
        newWidth = startWidth + delta;
      }
      newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      target.style.width = `${newWidth}px`;
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onPointerMove);
      document.removeEventListener('mouseup', onPointerUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('pointerdown', (event) => {
      isDragging = true;
      startX = event.clientX;
      const targetRect = target.getBoundingClientRect();
      startWidth = targetRect.width;
      rightEdge = targetRect.right;
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      handle.addEventListener('pointermove', onPointerMove);
      handle.addEventListener('pointerup', onPointerUp);
    });
  }

  setSupportNotice() {
    const notice = this.root.querySelector('#supportNotice');
    if (this.fs.isSupported()) {
      notice.hidden = true;
      return;
    }
    notice.hidden = false;
    notice.textContent = '当前浏览器不支持本地目录写入，请在最新版 Chrome 或 Edge 中运行扩展。';
  }

  async consumeImportedFile() {
    const importId = new URL(window.location.href).searchParams.get('import');
    if (!importId || !globalThis.chrome?.storage) {
      return null;
    }

    const key = `markdown-file:${importId}`;
    const storage = chrome.storage.session || chrome.storage.local;
    const imported = await new Promise((resolve) => {
      storage.get(key, (items) => resolve(items[key] || null));
    });

    if (imported) {
      await new Promise((resolve) => storage.remove(key, resolve));
    }

    return imported;
  }

  async resolvePreviewImageSource(source) {
    const workspacePath = this.currentFile?.path || (this.fs.rootHandle ? this.snapshotFile?.path : '');
    if (workspacePath) {
      const resourcePath = resolveWorkspaceResourcePath(source, workspacePath);
      if (resourcePath) {
        const file = await this.fs.readFileByPathParts(resourcePath);
        if (file) {
          return URL.createObjectURL(file);
        }
      }
    }

    const fileUrl = this.importedFile?.url || this.snapshotFile?.url || '';
    return resolveFileResourceUrl(source, fileUrl);
  }

  loadImportedFile(file) {
    this.currentFile = null;
    this.importedFile = file;
    this.snapshotFile = null;
    this.lastSavedContent = file.content || '';
    this.dirty = false;
    this.editor.setContent(this.lastSavedContent);
    this.preview.render(this.lastSavedContent);
    this.outline.update(this.lastSavedContent);
    this.setSaveStatus('idle', '只读导入');
    this.persistDocumentSnapshot();
  }

  loadDocumentSnapshot(snapshot) {
    this.currentFile = null;
    this.importedFile = null;
    this.snapshotFile = snapshot;
    this.lastSavedContent = snapshot.content || '';
    this.dirty = false;
    this.editor.setContent(this.lastSavedContent);
    this.preview.render(this.lastSavedContent);
    this.outline.update(this.lastSavedContent);
    this.setSaveStatus('idle', '正在恢复文件');
  }

  async persistDocumentSnapshot() {
    const source = this.currentFile || this.importedFile || this.snapshotFile;
    if (!source) {
      await this.preferences.save({ documentSnapshot: null });
      return;
    }

    await this.preferences.save({
      documentSnapshot: {
        name: source.name,
        path: source.path || '',
        url: source.url || '',
        content: this.editor.getContent(),
        updatedAt: Date.now()
      }
    });
  }

  async restorePreviousDirectory(activePath) {
    try {
      this.setSaveStatus('saving', '正在恢复目录');
      const tree = await this.fs.restoreDirectory();
      if (!tree) {
        this.setSaveStatus('idle', this.snapshotFile ? '等待恢复文件' : '未打开文件');
        return;
      }

      this.currentTree = tree;
      this.tree.setRoot(tree);

      const activeNode = activePath ? await this.fs.loadPath(tree, activePath) : null;
      if (activeNode) {
        this.tree.setRoot(tree);
      }
      if (activeNode?.type === 'file') {
        if (this.snapshotFile?.path === activeNode.path) {
          await this.bindRestoredFile(activeNode, this.snapshotFile.content || '');
          return;
        }
        await this.openFile(activeNode);
        return;
      }

      this.setSaveStatus('idle', this.snapshotFile ? '等待恢复文件' : '请选择文件');
    } catch (error) {
      console.warn('Failed to restore previous directory', error);
      this.setSaveStatus('idle', this.snapshotFile ? '等待恢复文件' : '未打开文件');
    }
  }

  async bindRestoredFile(node, snapshotContent) {
    const diskContent = await this.fs.readFile(node.handle);
    this.currentFile = node;
    this.importedFile = null;
    this.snapshotFile = null;
    this.lastSavedContent = diskContent;
    this.dirty = snapshotContent !== diskContent;
    this.editor.setContent(snapshotContent);
    this.preview.render(snapshotContent);
    this.outline.update(snapshotContent);
    this.tree.setActivePath(node.path);
    this.updateFileTitle();
    this.updateStats();
    this.setSaveStatus(this.dirty ? 'dirty' : 'saved', this.dirty ? '有未保存修改' : '已保存');
    await this.preferences.save({ activePath: node.path });
    this.persistDocumentSnapshot().catch((error) => console.warn('Failed to persist document snapshot', error));
  }

  async loadDirectoryHistory() {
    try {
      this.directoryHistory = await this.fs.getDirectoryHistory();
      this.renderDirectoryHistory();
    } catch (error) {
      console.warn('Failed to load directory history', error);
      this.directoryHistory = [];
      this.renderDirectoryHistory();
    }
  }

  renderDirectoryHistory() {
    const section = this.root.querySelector('#historySection');
    const toggle = this.root.querySelector('#historyToggleButton');
    const host = this.root.querySelector('#historyHost');
    if (!section || !toggle || !host) {
      return;
    }

    section.dataset.collapsed = this.historyCollapsed ? 'true' : 'false';
    toggle.setAttribute('aria-expanded', String(!this.historyCollapsed));
    toggle.querySelector('i')?.setAttribute('data-lucide', this.historyCollapsed ? 'chevron-right' : 'chevron-down');

    if (!this.directoryHistory.length) {
      host.innerHTML = '<div class="empty-state compact">暂无历史目录</div>';
      renderIcons();
      return;
    }

    const fragment = document.createDocumentFragment();
    this.directoryHistory.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'history-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.title = `打开历史目录：${item.name}`;
      button.innerHTML = `
        <i data-lucide="folder-open"></i>
        <span>${escapeHtml(item.name)}</span>
      `;
      button.addEventListener('click', () => this.openHistoryDirectory(index));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'history-delete';
      deleteButton.title = `删除历史目录：${item.name}`;
      deleteButton.innerHTML = '<i data-lucide="trash-2"></i>';
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        this.deleteHistoryDirectory(index);
      });

      row.append(button, deleteButton);
      fragment.append(row);
    });

    host.replaceChildren(fragment);
    renderIcons();
  }

  async toggleDirectoryHistory() {
    this.historyCollapsed = !this.historyCollapsed;
    await this.preferences.save({ historyCollapsed: this.historyCollapsed });
    this.renderDirectoryHistory();
  }

  async deleteHistoryDirectory(index) {
    const item = this.directoryHistory[index];
    if (!item) {
      return;
    }

    try {
      this.directoryHistory = await this.fs.deleteDirectoryHistoryItem(index);
      this.renderDirectoryHistory();
      this.setSaveStatus('idle', `已删除历史目录：${item.name}`);
    } catch (error) {
      this.showError(error);
    }
  }

  async openHistoryDirectory(index) {
    const item = this.directoryHistory[index];
    if (!item?.handle) {
      return;
    }

    try {
      await this.ensureSafeFileSwitch();
      this.setSaveStatus('saving', '正在打开历史目录');
      const tree = await this.fs.openDirectoryHandle(item.handle);
      if (!tree) {
        this.setSaveStatus('error', '历史目录需要重新授权');
        return;
      }
      await this.applyPickedDirectory(tree);
      await this.loadDirectoryHistory();
    } catch (error) {
      if (error.message === 'CANCELLED_BY_USER') {
        return;
      }
      this.showError(error);
    }
  }

  async openDirectory() {
    try {
      await this.ensureSafeFileSwitch();
      this.setSaveStatus('saving', '正在读取目录');
      const tree = await this.fs.pickDirectory();
      await this.applyPickedDirectory(tree);
      await this.loadDirectoryHistory();
    } catch (error) {
      if (error.name === 'AbortError') {
        const statusText = this.currentFile
          ? '已保存'
          : (this.importedFile ? '只读导入' : '未打开文件');
        this.setSaveStatus(this.currentFile ? 'saved' : 'idle', statusText);
        return;
      }
      if (error.message === 'CANCELLED_BY_USER') {
        return;
      }
      this.showError(error);
    }
  }

  async applyPickedDirectory(tree) {
    this.currentTree = tree;
    this.tree.setRoot(this.currentTree);

    this.importedFile = null;
    this.currentFile = null;
    this.snapshotFile = null;
    this.currentFileIsTxt = false;
    this.lastSavedContent = '';
    this.dirty = false;
    this.editor.setContent('');
    this.preview.render('');
    this.plaintextPreview.render('');
    this.outline.update('');
    await this.preferences.save({ activePath: '', documentSnapshot: null });
    this.setSaveStatus('idle', '请选择文件');
    this.updateFileTitle();
    this.updateStats();
    renderIcons();
  }

  async refreshDirectory() {
    if (!this.fs.rootHandle) {
      return;
    }
    try {
      this.currentTree = await this.fs.refreshTree();
      this.tree.setRoot(this.currentTree);
      this.tree.setActivePath(this.currentFile?.path || '');
      renderIcons();
    } catch (error) {
      if (error.message === 'CANCELLED_BY_USER') {
        return;
      }
      this.showError(error);
    }
  }

  async toggleDirectory(node) {
    if (this.tree.openPaths.has(node.path)) {
      node.isOpen = false;
      this.tree.openPaths.delete(node.path);
      this.tree.render();
      return;
    }

    try {
      this.setSaveStatus('saving', '正在加载文件夹');
      await this.fs.loadChildren(node);
      node.isOpen = true;
      this.tree.openPaths.add(node.path);
      this.tree.render();
      this.setSaveStatus(this.currentFile ? 'saved' : 'idle', this.currentFile ? '已保存' : '请选择文件');
    } catch (error) {
      this.showError(error);
    }
  }

  async openFile(node) {
    const shouldResetScroll = node.path !== this.currentFile?.path;

    try {
      await this.ensureSafeFileSwitch();
      this.setSaveStatus('saving', '正在打开文件');
      const content = await this.fs.readFile(node.handle);
      this.importedFile = null;
      this.snapshotFile = null;
      this.currentFile = node;
      this.currentFileIsTxt = node.isTxt || false;
      this.lastSavedContent = content;
      this.dirty = false;

      this.renderDocumentContent(content);

      if (shouldResetScroll) {
        this.resetDocumentScroll();
      }

      this.tree.setActivePath(node.path);
      this.updateFileTitle();
      this.setSaveStatus('saved', '已保存');
      await this.preferences.save({ activePath: node.path });
      this.persistDocumentSnapshot().catch((error) => console.warn('Failed to persist document snapshot', error));
      if (!this.currentFileIsTxt) {
        this.editor.focus();
      }
    } catch (error) {
      if (error.message === 'CANCELLED_BY_USER') {
        return;
      }
      this.showError(error);
    }
  }

  resetDocumentScroll() {
    this.scrollSync.syncing = false;
    this.editor.resetScroll();
    this.preview.resetScroll();
    this.plaintextPreview.resetScroll();
    this.outline.resetScroll();
  }

  async ensureSafeFileSwitch() {
    if (!this.dirty) {
      return;
    }

    if ((this.importedFile || this.snapshotFile) && !this.currentFile) {
      const shouldDiscard = window.confirm('当前内容还没有绑定到可写文件句柄。继续操作会丢弃未保存修改。');
      if (!shouldDiscard) {
        throw new Error('CANCELLED_BY_USER');
      }
      return;
    }

    if (this.autosave && this.currentFile) {
      await this.saveCurrentFile('auto');
      return;
    }

    const shouldSave = window.confirm('当前文件有未保存修改，是否先保存？');
    if (shouldSave) {
      await this.saveCurrentFile('manual');
    }
  }

  switchToMarkdown() {
    this.editor.setContent('');
    this.preview.render('');
    this.outline.update('');
    this.currentFileIsTxt = false;
    this.updateStats();
  }

  switchToPlaintext() {
    this.editor.setContent('');
    this.preview.render('');
    this.plaintextPreview.render('');
    this.outline.update('');
    this.currentFileIsTxt = true;
    this.updateStats();
  }

  async saveCurrentFile(mode) {
    if (!this.currentFile) {
      const message = this.importedFile
        ? '请先打开文件夹绑定文件'
        : (this.snapshotFile ? '请先恢复或打开文件夹' : '未打开文件');
      this.setSaveStatus(this.importedFile || this.snapshotFile ? 'error' : 'idle', message);
      return;
    }

    this.saveQueue = this.saveQueue.then(async () => {
      const content = this.editor.getContent();
      if (mode === 'auto' && content === this.lastSavedContent) {
        return;
      }

      try {
        this.setSaveStatus('saving', mode === 'auto' ? '自动保存中' : '保存中');
        await this.fs.writeFile(this.currentFile.handle, content);
        this.lastSavedContent = content;
        this.dirty = false;
        this.persistDocumentSnapshot().catch((error) => console.warn('Failed to persist document snapshot', error));
        this.setSaveStatus('saved', '已保存');
      } catch (error) {
        this.dirty = true;
        this.setSaveStatus('error', '保存失败');
        this.showError(error);
      }
    });

    await this.saveQueue;
  }

  async copyPlainText() {
    try {
      let plainText;
      if (this.currentFileIsTxt) {
        plainText = this.editor.getContent();
      } else {
        plainText = this.preview.toPlainText(this.editor.getContent());
      }
      await navigator.clipboard.writeText(plainText);
      this.setSaveStatus('saved', '已复制纯文本');
      window.setTimeout(() => {
        if (this.dirty) {
          const message = this.importedFile
            ? '只读修改未保存'
            : (this.snapshotFile ? '快照修改未保存' : '有未保存修改');
          this.setSaveStatus('dirty', message);
        } else {
          const message = this.currentFile
            ? '已保存'
            : (this.importedFile ? '只读导入' : (this.snapshotFile ? '等待恢复文件' : '未打开文件'));
          this.setSaveStatus(this.currentFile ? 'saved' : 'idle', message);
        }
      }, 1400);
    } catch (error) {
      this.showError(error);
    }
  }

  async adjustFontSize(delta) {
    const input = this.root.querySelector('#fontSizeInput');
    await this.setFontSize(Number(input.value || 16) + delta);
  }

  async setFontSize(value, persist = true) {
    const size = Math.max(13, Math.min(24, Number.isFinite(value) ? value : 16));
    document.documentElement.style.setProperty('--content-font-size', `${size}px`);
    this.root.querySelector('#fontSizeInput').value = String(size);

    if (persist) {
      await this.preferences.save({ fontSize: size });
    }
  }

  setAutosave(enabled, updateElement = true) {
    this.autosave = enabled;
    const toggle = this.root.querySelector('#autosaveToggle');
    if (updateElement) {
      toggle.checked = enabled;
    } else {
      toggle.checked = this.autosave;
    }
  }

  setPreviewAutoRefresh(enabled, updateElement = true) {
    this.previewAutoRefresh = enabled;
    const toggle = this.root.querySelector('#previewAutoRefreshToggle');
    if (toggle && updateElement) {
      toggle.checked = enabled;
    } else if (toggle) {
      toggle.checked = this.previewAutoRefresh;
    }
  }

  renderCurrentPreview() {
    const content = this.editor.getContent();
    this.preview.render(content);
    this.outline.update(content);
  }

  renderDocumentContent(content) {
    if (this.currentFileIsTxt) {
      this.editor.setContent('');
      this.plaintextPreview.render(content);
      this.outline.update('');
    } else {
      this.editor.setContent(content);
      this.preview.render(content);
      this.outline.update(content);
    }
    this.updateStats();
  }

  async readSourceContentFromDisk() {
    if (this.currentFile) {
      await this.saveQueue;
      return this.fs.readFile(this.currentFile.handle);
    }

    const url = this.importedFile?.url || this.snapshotFile?.url || '';
    if (!url) {
      return null;
    }

    let response;
    try {
      response = await fetch(url, { cache: 'no-store' });
    } catch (error) {
      throw new Error(`无法从磁盘重新读取该文件：${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`无法从磁盘重新读取该文件：HTTP ${response.status}`);
    }
    return response.text();
  }

  async syncDocumentWithDisk({ interactive = false } = {}) {
    const diskContent = await this.readSourceContentFromDisk();
    if (diskContent === null) {
      return 'no-source';
    }
    if (diskContent === this.lastSavedContent) {
      return 'unchanged';
    }

    if (this.dirty) {
      if (!interactive) {
        this.setSaveStatus('dirty', '磁盘文件已被外部修改，可点击“刷新预览”重新加载');
        return 'conflict';
      }
      const shouldReload = window.confirm('磁盘上的文件已被外部修改，重新加载会丢弃当前未保存的修改。是否继续？');
      if (!shouldReload) {
        this.setSaveStatus('dirty', '已保留本地修改');
        return 'conflict';
      }
    }

    this.lastSavedContent = diskContent;
    this.dirty = false;
    this.renderDocumentContent(diskContent);
    this.setSaveStatus('saved', '已从磁盘重新加载');
    this.persistDocumentSnapshot().catch((error) => console.warn('Failed to persist document snapshot', error));
    return 'reloaded';
  }

  async refreshDocumentView({ interactive = false } = {}) {
    try {
      const result = await this.syncDocumentWithDisk({ interactive });
      if (result === 'reloaded' || result === 'conflict') {
        return;
      }

      if (this.currentFileIsTxt) {
        this.plaintextPreview.render(this.lastSavedContent);
      } else {
        this.renderCurrentPreview();
      }
      this.setSaveStatus(this.dirty ? 'dirty' : 'saved', '预览已刷新');
    } catch (error) {
      this.showError(error);
    }
  }

  checkExternalChanges({ requireFileHandle = false } = {}) {
    if (!this.previewAutoRefresh || document.hidden) {
      return;
    }
    if (requireFileHandle && !this.currentFile) {
      return;
    }

    const now = Date.now();
    if (now - this.lastExternalCheckAt < 1000) {
      return;
    }
    this.lastExternalCheckAt = now;
    this.syncDocumentWithDisk({ interactive: false }).catch((error) => {
      console.warn('Failed to check external file changes', error);
    });
  }

  updateFileTitle() {
    const title = this.root.querySelector('#fileTitle');
    const path = this.root.querySelector('#filePath');
    const currentName = this.currentFile?.name || this.importedFile?.name || this.snapshotFile?.name || '未命名文档';
    title.textContent = currentName;
    const displayPath = formatDisplayPath(
      this.currentFile?.path ||
      this.importedFile?.url ||
      this.snapshotFile?.path ||
      this.snapshotFile?.url ||
      ''
    );
    if (this.currentFileIsTxt) {
      path.textContent = (displayPath || '纯文本文件') + '（TXT）';
    } else {
      path.textContent = displayPath || '选择文件夹后打开 Markdown 文件';
    }
  }

  updateStats() {
    const content = this.editor.getContent();
    const selection = this.editor.view.state.selection.main;
    const line = this.editor.view.state.doc.lineAt(selection.head);
    const column = selection.head - line.from + 1;
    const words = content.trim() ? content.trim().split(/\s+/).length : 0;
    const previewContent = this.currentFileIsTxt && !content ? this.lastSavedContent : content;

    this.root.querySelector('#statLines').textContent = `Lines: ${this.editor.view.state.doc.lines}`;
    this.root.querySelector('#statWords').textContent = `Words: ${words}`;
    this.root.querySelector('#statCursor').textContent = `Cursor: ${line.number}:${column}`;
    this.root.querySelector('#previewWordCount').textContent = `总字数：${countTotalCharacters(previewContent)}`;
  }

  setSaveStatus(type, text) {
    const status = this.root.querySelector('#saveStatus');
    status.className = `save-status ${type}`;
    status.textContent = text;
  }

  openContextMenu(event, node) {
    const menu = this.root.querySelector('#contextMenu');
    const canCreateInside = node.type === 'directory';
    const parentTarget = canCreateInside ? node : null;
    const actions = [
      canCreateInside && {
        icon: 'file-plus',
        label: '新建文件',
        run: () => this.createEntry(parentTarget, 'file')
      },
      canCreateInside && {
        icon: 'folder-plus',
        label: '新建文件夹',
        run: () => this.createEntry(parentTarget, 'directory')
      },
      {
        icon: 'pencil',
        label: '重命名',
        run: () => this.renameEntry(node)
      },
      node.path !== '/' && {
        icon: 'trash-2',
        label: '删除',
        danger: true,
        run: () => this.deleteEntry(node)
      }
    ].filter(Boolean);

    menu.replaceChildren(...actions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = action.danger ? 'danger' : '';
      button.innerHTML = `<i data-lucide="${action.icon}"></i><span>${escapeHtml(action.label)}</span>`;
      button.addEventListener('click', (clickEvent) => {
        clickEvent.stopPropagation();
        this.closeContextMenu();
        action.run();
      });
      return button;
    }));

    menu.hidden = false;
    const rect = this.root.getBoundingClientRect();
    menu.style.left = `${Math.min(event.clientX - rect.left, rect.width - 190)}px`;
    menu.style.top = `${Math.min(event.clientY - rect.top, rect.height - 170)}px`;
    renderIcons();
  }

  closeContextMenu() {
    const menu = this.root.querySelector('#contextMenu');
    menu.hidden = true;
  }

  async createInRoot(type) {
    if (!this.currentTree) {
      return;
    }
    await this.createEntry(this.currentTree, type);
  }

  async createEntry(parentNode, type) {
    try {
      const defaultName = type === 'file' ? 'untitled.md' : 'new-folder';
      const name = window.prompt(type === 'file' ? '文件名' : '文件夹名', defaultName);
      if (!name) {
        return;
      }

      if (type === 'file') {
        await this.fs.createFile(parentNode.handle, name);
      } else {
        await this.fs.createDirectory(parentNode.handle, name);
      }

      await this.refreshDirectory();
    } catch (error) {
      if (error.message === 'CANCELLED_BY_USER') {
        return;
      }
      this.showError(error);
    }
  }

  async renameEntry(node) {
    try {
      const name = window.prompt('新名称', node.name);
      if (!name || name === node.name) {
        return;
      }
      await this.ensureSafeFileSwitch();
      const activePath = this.currentFile?.path || '';
      const renamedPath = this.getSiblingPath(node.path, name);
      let activeTargetPath = null;

      if (node.type === 'file' && activePath === node.path) {
        activeTargetPath = renamedPath;
      }
      if (node.type === 'directory' && activePath.startsWith(`${node.path}/`)) {
        activeTargetPath = `${renamedPath}${activePath.slice(node.path.length)}`;
      }

      await this.fs.renameEntry(node, name);
      await this.refreshDirectory();
      if (activeTargetPath) {
        const renamedNode = await this.fs.loadPath(this.currentTree, activeTargetPath);
        if (renamedNode?.type === 'file') {
          await this.openFile(renamedNode);
        }
      }
    } catch (error) {
      if (error.message === 'CANCELLED_BY_USER') {
        return;
      }
      this.showError(error);
    }
  }

  async deleteEntry(node) {
    try {
      const confirmed = window.confirm(`确认删除“${node.name}”？此操作会直接修改本地文件系统。`);
      if (!confirmed) {
        return;
      }
      await this.ensureSafeFileSwitch();
      await this.fs.deleteEntry(node);
      if (this.currentFile?.path === node.path || this.currentFile?.path.startsWith(`${node.path}/`)) {
        this.currentFile = null;
        this.snapshotFile = null;
        this.currentFileIsTxt = false;
        this.lastSavedContent = '';
        this.dirty = false;
        this.editor.setContent('');
        this.preview.render('');
        this.plaintextPreview.render('');
        this.outline.update('');
        this.updateFileTitle();
        this.updateStats();
        this.setSaveStatus('idle', '未打开文件');
        await this.preferences.save({ activePath: '', documentSnapshot: null });
      }
      await this.refreshDirectory();
    } catch (error) {
      this.showError(error);
    }
  }

  showError(error) {
    console.error(error);
    this.setSaveStatus('error', error.message || '操作失败');
  }

  getSiblingPath(path, nextName) {
    const parentPath = path.slice(0, path.lastIndexOf('/'));
    return `${parentPath || ''}/${nextName}`;
  }
}

const app = new MarkdownStudioApp(document.querySelector('#app'));
app.init();
