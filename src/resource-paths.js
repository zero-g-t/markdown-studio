const ABSOLUTE_URL_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:/;

function isLocalResourcePath(resourcePath) {
  const value = String(resourcePath || '').trim();
  return Boolean(value) &&
    !ABSOLUTE_URL_PATTERN.test(value) &&
    !value.startsWith('//') &&
    !value.startsWith('#');
}

function withoutQueryAndHash(resourcePath) {
  const hashIndex = resourcePath.indexOf('#');
  const queryIndex = resourcePath.indexOf('?');
  const cutIndex = [hashIndex, queryIndex]
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  return cutIndex === undefined ? resourcePath : resourcePath.slice(0, cutIndex);
}

function decodePathPart(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

export function resolveWorkspaceResourcePath(resourcePath, documentPath) {
  if (!isLocalResourcePath(resourcePath) || !documentPath) {
    return null;
  }

  const cleanResourcePath = withoutQueryAndHash(resourcePath).replaceAll('\\', '/');
  const startsAtWorkspaceRoot = cleanResourcePath.startsWith('/');
  const baseParts = startsAtWorkspaceRoot
    ? []
    : String(documentPath).split('/').filter(Boolean).slice(0, -1);
  const resolvedParts = [...baseParts];

  for (const rawPart of cleanResourcePath.split('/')) {
    const part = decodePathPart(rawPart);
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (!resolvedParts.length) {
        return null;
      }
      resolvedParts.pop();
      continue;
    }
    resolvedParts.push(part);
  }

  return resolvedParts.length ? resolvedParts : null;
}

export function resolveFileResourceUrl(resourcePath, documentUrl) {
  if (!isLocalResourcePath(resourcePath) || !documentUrl) {
    return null;
  }

  try {
    return new URL(resourcePath, documentUrl).href;
  } catch {
    return null;
  }
}
