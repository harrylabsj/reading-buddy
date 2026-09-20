// 离线守卫：由 NODE_OPTIONS=--import=… 预加载到被测 CLI 子进程。
// 仅在 READING_OFFLINE_GUARD=1 时启用：任何真实网络/监听尝试都会直接抛错，
// 使“离线命令”测试真正拒绝网络行为，而不是仅靠观察没有 runtime.json 来推断。
import { createRequire } from 'node:module';

if (process.env.READING_OFFLINE_GUARD === '1') {
  const require = createRequire(import.meta.url);
  const deny = what => { throw new Error(`[offline-guard] 离线测试环境禁止${what}`); };

  globalThis.fetch = () => deny('fetch 网络请求');

  const net = require('node:net'); // CJS 导出对象可写（ESM 命名空间是只读的）
  net.Socket.prototype.connect = function () { return deny('Socket 连接'); };
  net.createConnection = () => deny('createConnection');
  net.connect = () => deny('net.connect');
  net.Server.prototype.listen = function () { return deny('监听端口'); };

  const http = require('node:http');
  http.request = () => deny('http 请求');
  http.get = () => deny('http 请求');

  const https = require('node:https');
  https.request = () => deny('https 请求');
  https.get = () => deny('https 请求');
}
