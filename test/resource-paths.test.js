import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveFileResourceUrl,
  resolveWorkspaceResourcePath
} from '../src/resource-paths.js';

test('resolves markdown image paths relative to the current workspace file', () => {
  assert.deepEqual(
    resolveWorkspaceResourcePath(
      'images/%E3%80%8A%E5%85%A8%E5%9F%9FAI%E5%A5%B3%E8%A3%85%E5%B8%A6%E8%B4%A7%EF%BC%8C%E5%A6%82%E4%BD%95%E5%88%B6%E4%BD%9C%E5%8E%BBAI%E6%84%9F%E7%B4%A0%E6%9D%90%E8%8E%B7%E5%8F%96%E7%B2%BE%E5%87%86%E5%A5%B3%E7%B2%89%E5%8F%98%E7%8E%B0%E4%BF%9D%E5%A7%86%E7%BA%A7%E5%AE%9E%E6%88%98%E6%95%99%E7%A8%8B%E3%80%8B-f4534cf7259879b448384e81f7e694ff.jpg',
      '/tutorials/post.md'
    ),
    [
      'tutorials',
      'images',
      '《全域AI女装带货，如何制作去AI感素材获取精准女粉变现保姆级实战教程》-f4534cf7259879b448384e81f7e694ff.jpg'
    ]
  );
});

test('keeps absolute image urls out of workspace resolution', () => {
  assert.equal(resolveWorkspaceResourcePath('https://example.com/a.jpg', '/post.md'), null);
  assert.equal(resolveWorkspaceResourcePath('data:image/png;base64,abc', '/post.md'), null);
  assert.equal(resolveWorkspaceResourcePath('blob:https://example.com/abc', '/post.md'), null);
});

test('resolves file imports against their source file url', () => {
  assert.equal(
    resolveFileResourceUrl('images/photo.jpg', 'file:///C:/docs/post.md'),
    'file:///C:/docs/images/photo.jpg'
  );
});
