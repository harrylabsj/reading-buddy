#!/usr/bin/env node
import {homedir} from 'node:os';
import {join} from 'node:path';
// The connector process is launched by WorkBuddy. No HTTP listener is created.
process.env.READING_AUTH_MODE='workbuddy';
if(!process.env.READING_DATA_DIR){
 const base=process.platform==='win32'?(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local')):process.platform==='darwin'?join(homedir(),'Library','Application Support'):(process.env.XDG_DATA_HOME||join(homedir(),'.local','share'));
 process.env.READING_DATA_DIR=join(base,'ReadingBuddy');
}
await import('./mcp.mjs');
