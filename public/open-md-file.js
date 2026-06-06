(() => {
  const fileName = decodeURIComponent(location.pathname.split('/').pop() || '');
  const lowerName = fileName.toLowerCase();
  const isMarkdown = ['.md', '.markdown', '.mdown', '.mkd'].some((extension) =>
    lowerName.endsWith(extension)
  );

  if (!isMarkdown || window.__markdownStudioHandled) {
    return;
  }

  window.__markdownStudioHandled = true;

  const pre = document.body?.children?.length === 1 ? document.querySelector('pre') : null;
  const content = pre ? pre.innerText : document.documentElement.innerText;

  chrome.runtime.sendMessage({
    type: 'OPEN_MARKDOWN_FILE',
    url: location.href,
    name: fileName || 'document.md',
    content
  });

  document.documentElement.innerHTML = `
    <head>
      <title>Opening Markdown Studio...</title>
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          font: 14px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          color: #202225;
          background: #f6f7f2;
        }
      </style>
    </head>
    <body>正在使用 Markdown Studio 打开 ${fileName || 'Markdown 文件'}...</body>
  `;
})();
