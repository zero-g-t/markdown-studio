/*
 * 工作区页签栏。
 *
 * 职责边界（刻意收窄）：
 * - 只维护「打开了哪些文件、当前激活哪个、每个文件的草稿状态」，不碰文件系统、不读写编辑器。
 * - 文件内容与脏标记由 MarkdownStudioApp 搬运进来（updateState），本模块只负责持有与展示。
 * - 关闭动作只做「要不要关、关哪些」的判定，真正的保存/确认/换页由 App 通过回调处理。
 */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function createTabRecord(entry) {
  return {
    path: entry.path,
    name: entry.name || entry.path.split('/').pop() || entry.path,
    isTxt: Boolean(entry.isTxt),
    // 草稿三件套：content 为 null 表示还没从磁盘读过
    content: null,
    lastSavedContent: '',
    dirty: false,
    scrollTop: 0
  };
}

export class WorkspaceTabs {
  constructor(host, callbacks = {}) {
    this.host = host;
    this.callbacks = callbacks;
    this.directoryName = '';
    this.tabs = [];
    this.activePath = '';
    this.bindHostEvents();
  }

  /* ---------- 项目目录生命周期 ---------- */

  reset(directoryName = '') {
    this.directoryName = directoryName;
    this.tabs = [];
    this.activePath = '';
    this.render();
  }

  restore(entries, activePath) {
    const seen = new Set();
    this.tabs = (Array.isArray(entries) ? entries : [])
      .filter((entry) => entry && typeof entry.path === 'string' && entry.path)
      .filter((entry) => {
        if (seen.has(entry.path)) {
          return false;
        }
        seen.add(entry.path);
        return true;
      })
      .map(createTabRecord);
    this.activePath = this.has(activePath) ? activePath : '';
    this.render();
    return this.tabs.length;
  }

  /* ---------- 查询 ---------- */

  has(path) {
    return this.tabs.some((tab) => tab.path === path);
  }

  getTab(path) {
    return this.tabs.find((tab) => tab.path === path) || null;
  }

  getActivePath() {
    return this.activePath;
  }

  list() {
    return this.tabs.map((tab) => ({ ...tab }));
  }

  getDirtyPaths(paths = this.tabs.map((tab) => tab.path)) {
    const scope = new Set(paths);
    return this.tabs.filter((tab) => scope.has(tab.path) && tab.dirty).map((tab) => tab.path);
  }

  // 右键菜单用：按动作算出「本次要关闭的页签集合」
  getCloseTargets(path, kind) {
    const index = this.tabs.findIndex((tab) => tab.path === path);
    if (index < 0) {
      return [];
    }
    switch (kind) {
      case 'others':
        return this.tabs.filter((tab) => tab.path !== path).map((tab) => tab.path);
      case 'right':
        return this.tabs.slice(index + 1).map((tab) => tab.path);
      case 'all':
        return this.tabs.map((tab) => tab.path);
      default:
        return [path];
    }
  }

  /* ---------- 变更 ---------- */

  openFile(entry) {
    const existing = this.getTab(entry.path);
    if (existing) {
      existing.name = entry.name || existing.name;
      existing.isTxt = Boolean(entry.isTxt);
      this.activate(entry.path);
      return existing;
    }

    const tab = createTabRecord(entry);
    this.tabs.push(tab);
    this.activePath = tab.path;
    this.render();
    return tab;
  }

  activate(path) {
    if (!this.has(path)) {
      return false;
    }
    if (this.activePath === path) {
      return true;
    }
    this.activePath = path;
    this.host.querySelectorAll('.workspace-tab').forEach((element) => {
      const isActive = element.dataset.path === path;
      element.classList.toggle('active', isActive);
      element.setAttribute('aria-selected', String(isActive));
    });
    this.ensureActiveVisible();
    return true;
  }

  clearActive() {
    this.activePath = '';
    this.host.querySelectorAll('.workspace-tab').forEach((element) => {
      element.classList.remove('active');
      element.setAttribute('aria-selected', 'false');
    });
  }

  updateState(path, patch) {
    const tab = this.getTab(path);
    if (!tab) {
      return;
    }
    Object.assign(tab, patch);
    if (Object.prototype.hasOwnProperty.call(patch, 'dirty')) {
      this.setDirty(path, Boolean(patch.dirty));
    }
  }

  // 只切换脏点，不整栏重渲染（编辑时高频调用）
  setDirty(path, dirty) {
    const tab = this.getTab(path);
    if (!tab) {
      return;
    }
    tab.dirty = Boolean(dirty);
    const element = this.host.querySelector(`.workspace-tab[data-path="${CSS.escape(path)}"]`);
    if (element) {
      element.classList.toggle('dirty', tab.dirty);
      element.title = tab.dirty ? `${tab.name}（有未保存修改）` : tab.path;
    }
  }

  renamePath(oldPath, nextPath) {
    let changed = false;
    this.tabs.forEach((tab) => {
      if (tab.path === oldPath || tab.path.startsWith(`${oldPath}/`)) {
        tab.path = `${nextPath}${tab.path.slice(oldPath.length)}`;
        tab.name = tab.path.split('/').pop() || tab.name;
        changed = true;
      }
      if (this.activePath === oldPath || this.activePath.startsWith(`${oldPath}/`)) {
        this.activePath = `${nextPath}${this.activePath.slice(oldPath.length)}`;
      }
    });
    if (changed) {
      this.render();
    }
    return changed;
  }

  // 批量移除，返回移除后应当激活的路径（'' 表示没有页签了）
  removePaths(paths) {
    const scope = new Set(paths);
    if (!scope.size) {
      return this.activePath;
    }

    const previousTabs = this.tabs;
    const activeIndex = previousTabs.findIndex((tab) => tab.path === this.activePath);
    const removedActive = scope.has(this.activePath);
    const remaining = previousTabs.filter((tab) => !scope.has(tab.path));

    let nextActive = this.activePath;
    if (!remaining.length) {
      nextActive = '';
    } else if (removedActive) {
      nextActive = '';
      for (let index = activeIndex + 1; index < previousTabs.length; index += 1) {
        if (!scope.has(previousTabs[index].path)) {
          nextActive = previousTabs[index].path;
          break;
        }
      }
      if (!nextActive) {
        for (let index = activeIndex - 1; index >= 0; index -= 1) {
          if (!scope.has(previousTabs[index].path)) {
            nextActive = previousTabs[index].path;
            break;
          }
        }
      }
      if (!nextActive) {
        nextActive = remaining[0].path;
      }
    }

    this.tabs = remaining;
    this.activePath = nextActive;
    this.render();
    return nextActive;
  }

  /* ---------- 序列化（只存元数据，不存文件内容） ---------- */

  serialize() {
    return {
      directoryName: this.directoryName,
      activePath: this.activePath,
      tabs: this.tabs.map((tab) => ({ path: tab.path, name: tab.name, isTxt: tab.isTxt }))
    };
  }

  /* ---------- 渲染 ---------- */

  bindHostEvents() {
    this.host.addEventListener(
      'wheel',
      (event) => {
        if (event.deltaY === 0 || this.host.scrollWidth <= this.host.clientWidth) {
          return;
        }
        event.preventDefault();
        this.host.scrollLeft += event.deltaY;
      },
      { passive: false }
    );
  }

  render() {
    this.host.hidden = this.tabs.length === 0;
    if (!this.tabs.length) {
      this.host.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    this.tabs.forEach((tab) => fragment.append(this.renderTab(tab)));
    this.host.replaceChildren(fragment);
    this.callbacks.renderIcons?.();
    this.ensureActiveVisible();
  }

  renderTab(tab) {
    const element = document.createElement('div');
    const isActive = tab.path === this.activePath;
    element.className = `workspace-tab${isActive ? ' active' : ''}${tab.dirty ? ' dirty' : ''}`;
    element.dataset.path = tab.path;
    element.setAttribute('role', 'tab');
    element.setAttribute('aria-selected', String(isActive));
    element.tabIndex = isActive ? 0 : -1;
    element.title = tab.dirty ? `${tab.name}（有未保存修改）` : tab.path;

    element.innerHTML = `
      <i class="tab-icon" data-lucide="file-text"></i>
      <span class="tab-label">${escapeHtml(tab.name)}</span>
      <span class="tab-dirty-dot" aria-hidden="true"></span>
      <button class="tab-close" type="button" title="关闭 ${escapeHtml(tab.name)}" aria-label="关闭 ${escapeHtml(tab.name)}">
        <i data-lucide="x"></i>
      </button>
    `;

    element.addEventListener('click', () => {
      if (tab.path !== this.activePath) {
        void this.callbacks.onActivate?.(tab.path);
      }
    });

    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      event.preventDefault();
      if (tab.path !== this.activePath) {
        void this.callbacks.onActivate?.(tab.path);
      }
    });

    element.addEventListener('auxclick', (event) => {
      if (event.button !== 1) {
        return;
      }
      event.preventDefault();
      void this.callbacks.onRequestClose?.([tab.path]);
    });

    element.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.callbacks.onContextMenu?.(event, tab.path);
    });

    element.querySelector('.tab-close').addEventListener('click', (event) => {
      event.stopPropagation();
      void this.callbacks.onRequestClose?.([tab.path]);
    });

    return element;
  }

  ensureActiveVisible() {
    if (!this.activePath) {
      return;
    }
    const element = this.host.querySelector('.workspace-tab.active');
    if (!element) {
      return;
    }
    const hostRect = this.host.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    if (rect.left < hostRect.left) {
      this.host.scrollLeft -= hostRect.left - rect.left + 8;
    } else if (rect.right > hostRect.right) {
      this.host.scrollLeft += rect.right - hostRect.right + 8;
    }
  }
}
