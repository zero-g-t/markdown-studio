import MarkdownIt from 'markdown-it';

const outlineMarkdown = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  breaks: true
});

function inlineTokensToText(tokens = []) {
  return tokens
    .map((token) => {
      if (token.type === 'html_inline' || token.type === 'html_block') {
        return '';
      }
      if (token.children?.length) {
        return inlineTokensToText(token.children);
      }
      return token.content || '';
    })
    .join('');
}

export function extractOutlineItems(markdownSource) {
  const tokens = outlineMarkdown.parse(markdownSource, {});
  const items = [];

  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open') {
      return;
    }

    const inlineToken = tokens[index + 1];
    if (inlineToken?.type !== 'inline') {
      return;
    }

    const text = inlineTokensToText(inlineToken.children || [inlineToken]).trim();
    if (!text) {
      return;
    }

    items.push({
      level: Number(token.tag.slice(1)),
      text,
      lineNumber: (token.map?.[0] ?? 0) + 1
    });
  });

  return items;
}
