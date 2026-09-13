#!/bin/zsh
cd -- "${0:A:h}"
if ! command -v node >/dev/null 2>&1; then
  print '需要 Node.js 22 或更新版本。安装后重新打开。'
  read -k 1
  exit 1
fi
if [[ ! -d node_modules ]]; then
  print '首次使用：请在此目录运行 npm ci 和 npm run build。'
  read -k 1
  exit 1
fi
print '读书搭子：http://localhost:3788'
npm start
