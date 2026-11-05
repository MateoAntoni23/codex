import { spawn } from 'node:child_process';
const python = process.env.TRAY_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const children = [spawn(python, ['server/tray_service.py'], {stdio:'inherit'}), spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','localhost','--port','5173','--strictPort'],{stdio:'inherit'})];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const p of children)p.kill();process.exitCode=code;}
for(const p of children){p.on('error',e=>{console.error(e.message);stop(1)});p.on('exit',c=>stop(c||0));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
