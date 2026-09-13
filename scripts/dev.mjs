import { spawn } from 'node:child_process';
const child = spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',env:{...process.env,PORT:'3789',READING_DEV_PORT:'3788'}});
const vite = spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','3788','--strictPort',...process.argv.slice(2)],{stdio:'inherit'});
function stop(){child.kill();vite.kill();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);child.on('exit',()=>vite.kill());vite.on('exit',()=>child.kill());
