#!/usr/bin/env node
/* ============================================================
   cdp-probe.js — 零依赖的 Edge/Chrome CDP 探针
   用途：无头加载页面 → 抓运行时异常 → 求值表达式 → 截图
   用法：
     node scripts/cdp-probe.js --url file:///C:/path/index.html \
       [--exec "<js 表达式>"]... [--w 1280 --h 800 --shot out.png]...
   依赖：Node >= 22（内置 fetch / WebSocket），本机 Edge/Chrome
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');

function arg(name, def){ const i=process.argv.indexOf('--'+name); return i>0 ? process.argv[i+1] : def; }
const has = n => process.argv.includes('--'+n);

const URL_ = arg('url');
if(!URL_){ console.error('need --url'); process.exit(2); }

/* ---- 找浏览器 ---- */
const CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
];
const browser = CANDIDATES.find(p => fs.existsSync(p));
if(!browser){ console.error('no Edge/Chrome found'); process.exit(2); }

const PORT = 9337 + Math.floor(Math.random()*400);
const udir = fs.mkdtempSync(path.join(os.tmpdir(),'cdpprobe-'));

const proc = spawn(browser, [
  '--headless=new', '--remote-debugging-port='+PORT, '--user-data-dir='+udir,
  '--no-first-run','--no-default-browser-check','--disable-extensions',
  '--window-size=1400,900','about:blank',
], { stdio:'ignore' });

const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function waitPort(){
  for(let i=0;i<60;i++){
    try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/version`); if(r.ok) return; }catch(e){}
    await sleep(250);
  }
  throw new Error('browser did not open CDP port');
}

let msgId=0; const pending=new Map(); const listeners=[];
function send(ws, method, params){
  return new Promise((res,rej)=>{
    const id=++msgId; pending.set(id,{res,rej});
    ws.send(JSON.stringify({id,method,params:params||{}}));
  });
}

(async ()=>{
  await waitPort();
  // 新建标签页
  const put = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_)}`, {method:'PUT'});
  let target = await put.json();
  if(!target.webSocketDebuggerUrl){ // 老版本 GET
    const g = await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(URL_)}`);
    target = await g.json();
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=err=>rej(new Error('ws error')); });
  ws.onmessage = ev=>{
    const m = JSON.parse(ev.data);
    if(m.id && pending.has(m.id)){ const p=pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    for(const l of listeners) l(m);
  };

  const exceptions=[];
  listeners.push(m=>{
    if(m.method==='Runtime.exceptionThrown'){
      const d=m.params.exceptionDetails;
      const txt = d.exception && (d.exception.description||d.exception.value) || d.text;
      exceptions.push(`${txt}  (line ${d.lineNumber+1}:${d.columnNumber+1})`);
    }
  });
  await send(ws,'Runtime.enable');
  await send(ws,'Page.enable');

  /* ---- 可选：先设定视口再求值（--vsize WxH）---- */
  const vsize = arg('vsize');
  if(vsize){
    const [w,h] = vsize.split('x').map(Number);
    await send(ws,'Emulation.clearDeviceMetricsOverride').catch(()=>{});
    await send(ws,'Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
    await sleep(500);
  }

  await sleep(400);   // 给脚本/首帧留时间

  /* ---- 依序执行 --exec ---- */
  for(const expr of collect('exec')){
    try{
      const r = await send(ws,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
      if(r.exceptionDetails){ console.log('EVAL-ERROR:', r.exceptionDetails.exception && (r.exceptionDetails.exception.description||r.exceptionDetails.exception.value) || r.exceptionDetails.text); }
      else console.log(typeof r.result.value==='string' ? r.result.value : JSON.stringify(r.result.value));
    }catch(e){ console.log('EVAL-FAIL:', e.message); }
  }

  /* ---- 截图（可多组 --w/--h/--shot） ---- */
  /* ---- 可选：中途改视口后追加求值（--resize WxH --postexec <js>）---- */
  const resize = arg('resize');
  if(resize){
    const [w,h] = resize.split('x').map(Number);
    await send(ws,'Emulation.clearDeviceMetricsOverride').catch(()=>{});
    await send(ws,'Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
    await sleep(500);
    for(const expr of collect('postexec')){
      try{
        const r = await send(ws,'Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true});
        if(r.exceptionDetails){ console.log('POSTEVAL-ERROR:', r.exceptionDetails.exception && (r.exceptionDetails.exception.description||r.exceptionDetails.exception.value) || r.exceptionDetails.text); }
        else console.log(typeof r.result.value==='string' ? r.result.value : JSON.stringify(r.result.value));
      }catch(e){ console.log('POSTEVAL-FAIL:', e.message); }
    }
  }

  const shots = collectShotTriples();
  for(const s of shots){
    // 即使尺寸没变也重新下发 override —— 强制合成器出一帧（否则 headless 截图可能拿到旧帧）
    let w=s.w, h=s.h;
    if(!w || !h){
      const r = await send(ws,'Runtime.evaluate',{expression:'window.innerWidth+" "+window.innerHeight',returnByValue:true});
      [w,h] = r.result.value.split(' ').map(Number);
    }
    await send(ws,'Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
    await sleep(400);
    const r = await send(ws,'Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(s.shot, Buffer.from(r.data,'base64'));
    console.log(`SHOT ${w}x${h} -> ${s.shot}`);
  }

  if(exceptions.length){
    console.log('--- 页面异常 ---');
    for(const e of exceptions) console.log('EXCEPTION:', e);
  } else console.log('NO PAGE EXCEPTIONS');

  ws.close(); proc.kill(); process.exit(0);
})().catch(e=>{ console.error('PROBE-FAIL:', e.message); proc.kill(); process.exit(1); });

function collect(name){ const out=[]; const a=process.argv; for(let i=0;i<a.length;i++) if(a[i]==='--'+name) out.push(a[++i]); return out; }
function collectShotTriples(){
  const a=process.argv, out=[]; let cur={};
  for(let i=0;i<a.length;i++){
    if(a[i]==='--w') cur.w=+a[i+1];
    else if(a[i]==='--h') cur.h=+a[i+1];
    else if(a[i]==='--shot'){ cur.shot=a[i+1]; out.push(cur); cur={}; }
  }
  return out.filter(s=>s.shot);
}
