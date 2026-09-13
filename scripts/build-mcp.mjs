import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const target = 'es2022';
const [ui, connector] = await Promise.all([
  build({ entryPoints: ['src/mcp-entry.jsx'], bundle: true, minify: true, format: 'iife', write: false, target }),
  build({ entryPoints: ['server/mcp-launcher.mjs'], bundle: true, minify: true, platform: 'node', format: 'esm', write: false, target, external: ['node:*'] }),
]);
const assets = Object.fromEntries(['reading-light.png', 'demo-book.png'].map(name => {
  const type = 'image/png';
  return [`/assets/${name}`, `data:${type};base64,${readFileSync(resolve(root, 'public/assets', name)).toString('base64')}`];
}));
const css = readFileSync(resolve(root, 'src/styles.css'), 'utf8');
const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>读书搭子</title><style>${css.replaceAll('</style', '<\\/style')}</style></head><body><div id="root"></div><script>window.__READING_EMBEDDED__=true;window.__READING_MODE__='live';window.__READING_ASSETS__=${JSON.stringify(assets)};</script><script>${ui.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
mkdirSync('dist/mcp', { recursive: true });
writeFileSync('dist/mcp/dashboard.html', html);
writeFileSync('dist/mcp/reading-buddy-connector.mjs', connector.outputFiles[0].text);
console.log('本地 WorkBuddy 连接器和完整内嵌阅读看板已构建。');
