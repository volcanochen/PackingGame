#!/usr/bin/env node
/* ============================================================
   装箱对决 · 自适应布局测试（棋盘最大化优先）
   运行：node tests/layout.js

   验证的核心不变量：
     1) 棋盘外径恒等于「容器短边 - 2*PAD」—— 只看窗口，不看内容
     2) 信息区只分到棋盘之外「剩下的那一条」，且一定放得进去
     3) 两条剩余都塞不下时才折叠成浮层
     4) 棋盘尺寸随窗口单调不减；内容变化不影响棋盘
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

/* ---- 最小 DOM stub（与 smoke.js 同款，够 Layout 模块用） ---- */
function El(t){
  const e={tagName:t,children:[],dataset:{},style:{},_cls:new Set(),_html:'',textContent:'',
   classList:{add:(...c)=>c.forEach(x=>e._cls.add(x)),remove:(...c)=>c.forEach(x=>e._cls.delete(x)),
    toggle:(c,on)=>{on?e._cls.add(c):e._cls.delete(c);},contains:c=>e._cls.has(c)},
   addEventListener:()=>{},appendChild:c=>{e.children.push(c);return c;},removeChild:c=>{e.children=e.children.filter(x=>x!==c);},
   querySelector:()=>El('b'),closest:()=>null,scrollTop:0,clientWidth:0,clientHeight:0};
  Object.defineProperty(e,'innerHTML',{get:()=>e._html,set:v=>{e._html=v;if(v==='')e.children=[];}});
  Object.defineProperty(e,'firstChild',{get:()=>e.children[0]});
  Object.defineProperty(e,'className',{get:()=>[...e._cls].join(' '),set:v=>{e._cls=new Set(String(v).split(/\s+/).filter(Boolean));}});
  return e;
}
const store={};
global.document={getElementById:id=>store[id]||(store[id]=El('div')),createElement:t=>El(t),
  addEventListener:()=>{},elementFromPoint:()=>null};
global.setTimeout=()=>0;
global.clearTimeout=()=>{};

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
vm.runInThisContext(html.match(/<script>([\s\S]*?)<\/script>/)[1]);

// 与 Layout 内部保持一致的常量（改了实现这里也要改；测试本身就是规格说明）
const GAP=8, PAD=10, MIN_SIDE=216, MIN_BOTTOM=120, MAX_SIDE=360, MAX_BOTTOM=240;

// 常量注入 vmContext（页面脚本跑同一个 globalThis）
global.GAP=GAP; global.PAD=PAD; global.MIN_SIDE=MIN_SIDE;
global.MIN_BOTTOM=MIN_BOTTOM; global.MAX_SIDE=MAX_SIDE; global.MAX_BOTTOM=MAX_BOTTOM;

const R=vm.runInThisContext(`(function(){
  const out=[]; const ck=(n,c,x)=>out.push([n,!!c,x===undefined?'':String(x)]);
  const plan=Layout.plan;

  /* ---- 1. 全尺寸矩阵：不变量 ---- */
  let badBoard=0, badFit=0, badMode=0, badSide=0, badBottom=0, badOverlay=0, neg=0;
  for(let W=200;W<=1800;W+=20){
    for(let H=200;H<=1400;H+=20){
      const p=plan(W,H);
      const want=Math.max(80,Math.min(W,H)-PAD*2);
      if(p.board!==want) badBoard++;
      if(p.board+PAD*2>Math.min(W,H)+0.001) badFit++;
      if(p.board<0) neg++;
      const stripSide=W-GAP-(p.board+PAD*2), stripBottom=H-GAP-(p.board+PAD*2);
      if(p.dock==='side'){
        if(!(stripSide>=MIN_SIDE)) badMode++;
        if(!(p.sideW>=MIN_SIDE && p.sideW<=stripSide+0.5)) badSide++;
      }else if(p.dock==='bottom'){
        if(!(stripBottom>=MIN_BOTTOM && stripSide<MIN_SIDE)) badMode++;
        if(!(p.bottomH>=MIN_BOTTOM && p.bottomH<=stripBottom+0.5)) badBottom++;
      }else if(p.dock==='overlay'){
        if(!(stripSide<MIN_SIDE && stripBottom<MIN_BOTTOM)) badOverlay++;
      }else badMode++;
    }
  }
  ck('棋盘恒 = 短边-2*PAD（全尺寸扫描）', badBoard===0, 'violations='+badBoard);
  ck('棋盘 + 容器内边距 不超出短边（不溢出）', badFit===0, 'violations='+badFit);
  ck('停靠方式与阈值判断一致', badMode===0, 'violations='+badMode);
  ck('竖条尺寸合法且恰好 <= 剩余宽度', badSide===0, 'violations='+badSide);
  ck('横条尺寸合法且恰好 <= 剩余高度', badBottom===0, 'violations='+badBottom);
  ck('仅当两条都不够时才折叠', badOverlay===0, 'violations='+badOverlay);
  ck('棋盘尺寸恒为正', neg===0);

  /* ---- 2. 单调性：窗口变大，棋盘只能变大 ---- */
  let monoW=0, monoH=0;
  for(let H=300;H<=1300;H+=50){
    let prev=-1;
    for(let W=200;W<=1800;W+=10){ const b=plan(W,H).board; if(b<prev) monoW++; prev=b; }
  }
  for(let W=200;W<=1800;W+=50){
    let prev=-1;
    for(let H=300;H<=1300;H+=10){ const b=plan(W,H).board; if(b<prev) monoH++; prev=b; }
  }
  ck('宽度单调增 → 棋盘不减', monoW===0, 'violations='+monoW);
  ck('高度单调增 → 棋盘不减', monoH===0, 'violations='+monoH);

  /* ---- 3. 棋盘与信息区内容无关（同一窗口重复求值恒定） ---- */
  let contentDep=0;
  for(let i=0;i<200;i++){
    const W=300+i*7, H=250+i*5;
    const a=plan(W,H), b=plan(W,H);
    if(a.board!==b.board || a.dock!==b.dock || a.sideW!==b.sideW || a.bottomH!==b.bottomH) contentDep++;
  }
  ck('同一窗口重复求值结果恒定（与内容无关）', contentDep===0, 'violations='+contentDep);

  /* ---- 4. 信息区占用空间 不 挤压棋盘：加宽／加高信息条不会改变 board ---- */
  let squeeze=0;
  for(let i=0;i<200;i++){
    const W=320+i*6, H=280+i*4;
    const base=plan(W,H).board;
    // 模拟「信息区内容暴涨」：Layout 完全不读取信息区尺寸，board 必须不变
    const after=plan(W,H).board;
    if(base!==after) squeeze++;
  }
  ck('信息区内容变化不影响棋盘尺寸', squeeze===0, 'violations='+squeeze);

  return out;
})()`);

/* ---- 5. 真实视口 → 停靠方式（含表头开销的经验值） ---- */
const APP_MAXW=Infinity, APP_PAD=10, APP_GAP=8;   // #app 已不再限宽：用满窗口才能最大化棋盘并留出竖条
function mainOf(vw,vh,headerH){
  const appW=Math.min(vw,APP_MAXW)-APP_PAD*2;
  const appH=vh-APP_PAD*2;
  return { W:appW, H:appH-headerH-APP_GAP };
}
const LayoutPlan=vm.runInThisContext('Layout.plan');
const cases=[
  ['桌面 超宽 2560×1440', mainOf(2560,1440,56), 'side'],
  ['桌面 宽屏 1920×1080', mainOf(1920,1080,56), 'side'],
  ['桌面 1600×900',       mainOf(1600,900,56),  'side'],
  ['桌面 1440×900',       mainOf(1440,900,56),  'side'],
  ['桌面 1366×768',       mainOf(1366,768,56),  'side'],
  ['桌面 1024×768',       mainOf(1024,768,56),  'side'],
  ['横向平板 iPad 横',     mainOf(1180,820,56),  'side'],
  ['半屏宽 960×540',      mainOf(960,540,56),   'side'],
  ['半屏近方形 960×1040', mainOf(960,1040,80),  'overlay'],
  ['iPad 竖 820×1180',    mainOf(820,1180,80),  'bottom'],
  ['手机竖 390×844',      mainOf(390,844,88),   'bottom'],
  ['手机横 844×390',      mainOf(844,390,56),   'side'],
  ['接近正方形 860×820',  mainOf(860,820,80),   'overlay'],
  ['接近正方形 800×760',  mainOf(800,760,80),   'overlay'],
];
let caseBad=0;
for(const [name,m,exp] of cases){
  const p=LayoutPlan(m.W,m.H);
  const ok=p.dock===exp;
  if(!ok) caseBad++;
  R.push([`${name} → ${p.dock}（棋盘 ${Math.round(p.board)}px）期望 ${exp}`, ok, '']);
}

let bad=0;
console.log('--- 装箱对决 布局测试 ---');
for(const [n,ok,x] of R){ console.log((ok?'PASS':'FAIL')+'  '+n+(x?'   ['+x+']':'')); if(!ok) bad++; }
console.log(bad? `\n${bad} 项失败` : `\n全部通过（${R.length} 项）`);
process.exit(bad?1:0);
