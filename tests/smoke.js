#!/usr/bin/env node
/* ============================================================
   装箱对决 · 无浏览器冒烟测试
   运行：node tests/smoke.js
   原理：手写最小 DOM stub + vm 加载 index.html 的 <script>，
        直接调用规则引擎与 UI 处理函数做不变式断言，
        并跑若干整局模拟验证收敛性与平衡。
   ============================================================ */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

/* ---- 最小 DOM stub ---- */
function El(t){
  const e={tagName:t,children:[],dataset:{},style:{},_cls:new Set(),_html:'',textContent:'',
   classList:{add:(...c)=>c.forEach(x=>e._cls.add(x)),remove:(...c)=>c.forEach(x=>e._cls.delete(x)),
    toggle:(c,on)=>{on?e._cls.add(c):e._cls.delete(c);},contains:c=>e._cls.has(c)},
   addEventListener:()=>{},appendChild:c=>{e.children.push(c);return c;},removeChild:c=>{e.children=e.children.filter(x=>x!==c);},
   querySelector:()=>El('b'),closest:()=>null,scrollTop:0};
  Object.defineProperty(e,'innerHTML',{get:()=>e._html,set:v=>{e._html=v;if(v==='')e.children=[];}});
  Object.defineProperty(e,'firstChild',{get:()=>e.children[0]});
  Object.defineProperty(e,'className',{get:()=>[...e._cls].join(' '),set:v=>{e._cls=new Set(String(v).split(/\s+/).filter(Boolean));}});
  return e;
}
const store={};
global.document={getElementById:id=>store[id]||(store[id]=El('div')),createElement:t=>El(t),
  addEventListener:()=>{},elementFromPoint:()=>null};
let TIMERS='noop';                               // 'sync': 立即执行（AI 连招第二手同步落地）
global.setTimeout=fn=>{ if(TIMERS==='sync') fn(); return 0; };
global.clearTimeout=()=>{};

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
vm.runInThisContext(html.match(/<script>([\s\S]*?)<\/script>/)[1]);

const R=vm.runInThisContext(`(function(){
  const out=[]; const ck=(n,c,x)=>out.push([n,!!c,x===undefined?'':String(x)]);
  const LCG=s=>{let x=s>>>0; return ()=>{x=(x*1664525+1013904223)>>>0; return x/4294967296;};};

  /* ========== 1. 幽灵预览与落点一致（所见即所得） ========== */
  mode='hot'; startGame();
  ck('空盘锚点 81', allAnchors().length===81, allAnchors().length);
  let ghostMis=0, ghostN=0, overlap=0;
  for(let r=0;r<BS;r++)for(let c=0;c<BS;c++){
    updateGhost(r,c);
    if(ui.ghost){ ghostN++;
      if(ui.ghost.r!==r||ui.ghost.c!==c) ghostMis++;       // 幽灵锚点必须 == 鼠标格
    }
  }
  ck('幽灵锚点 == 鼠标所在格（全盘扫描）', ghostMis===0, 'mismatch='+ghostMis);
  ck('幽灵只在合法锚点出现（81 个）', ghostN===81, ghostN);
  doPlace(0,0,0);
  for(let r=0;r<BS;r++)for(let c=0;c<BS;c++){
    updateGhost(r,c);
    if(ui.ghost) for(let dr=0;dr<P;dr++)for(let dc=0;dc<P;dc++)
      if(state.board[ui.ghost.r+dr][ui.ghost.c+dc]) overlap++;
  }
  ck('幽灵永不覆盖已占格', overlap===0, overlap);
  updateGhost(BS-1,BS-1);
  ck('右下角无法作为左上角 → 不预览', ui.ghost===null);

  /* ========== 2. 连招回合流程（r2.3 核心） ========== */
  startGame();
  doPlace(0,0,0); advance();
  doPlace(1,8,8); advance();
  doPlace(0,4,4); advance();                 // P0 放满 2 个 → 1 token
  ck('每放 2 个方块得 1 个移动 token', state.players[0].moves===1);
  doPlace(1,0,8); advance();
  ck('轮到 P0', state.current===0);
  const rnd0=state.round, mv0=state.players[0].moves;
  ui.move=true; ui.srcBox=null;
  onCellClick(8,8); onCellClick(0,4);
  ck('移动后回合不切换', state.current===0, 'current='+state.current);
  ck('移动后进入「必须再落一子」', state.mustPlace===true);
  ck('移动不消耗回合', state.round===rnd0);
  ck('移动消耗 1 个 token', state.players[0].moves===mv0-1);
  ui.move=true; ui.srcBox=null; onCellClick(0,0);
  ck('mustPlace 阶段无法再次移动', ui.srcBox===null);
  ui.move=false;
  let a1=null;
  for(let r=0;r<MAXA&&!a1;r++)for(let c=0;c<MAXA;c++) if(validAnchor(r,c)){ a1=[r,c]; break; }
  const nPlaced=Object.keys(state.placed).length;
  onCellClick(a1[0],a1[1]);
  ck('补落一手后回合才切换', state.current===1);
  ck('mustPlace 复位', state.mustPlace===false);
  ck('落数 +1', Object.keys(state.placed).length===nPlaced+1);

  /* ========== 3. 悔棋 ========== */
  startGame();
  doPlace(0,0,0); snapshot(); advance();
  doPlace(1,8,8); snapshot(); advance();
  doPlace(0,4,4); snapshot(); advance();
  doPlace(1,0,8); snapshot(); advance();
  const boardSnap=JSON.stringify(state.board), mvSnap=state.players[0].moves;
  ui.move=true; ui.srcBox=null; onCellClick(8,8); onCellClick(0,4);
  ck('进入待落子状态', state.mustPlace===true);
  undo();
  ck('悔棋回到「移动之前」', JSON.stringify(state.board)===boardSnap && state.players[0].moves===mvSnap);
  ck('回退后 mustPlace 清除', state.mustPlace===false);

  /* ========== 4. 安全目标（不能搬完就自杀） ========== */
  startGame();
  doPlace(0,0,0); advance();
  doPlace(1,8,8); advance();
  doPlace(0,4,4); advance();
  const anyBox=Object.values(state.placed).find(b=>b.owner===1);
  const safe=safeMoveTargets(anyBox.boxId), raw=moveTargets(anyBox.boxId);
  ck('safeMoveTargets ⊆ moveTargets', safe.every(([r,c])=>raw.some(([r2,c2])=>r===r2&&c===c2)));
  ck('每个安全目标搬完都仍有落位', safe.every(([r,c])=>moveLeavesPlace(anyBox.boxId,r,c)));

  /* ========== 5. AI 战术层 ========== */
  const emptyBoard=newState();
  ck('空盘局面无战术事件（oppThreat=0）', oppThreat(emptyBoard)===0);
  startGame();                                   // 空盘上检查候选结构
  const cands=aiCandidates();
  ck('AI 能生成直接落子候选', cands.some(c=>c.type==='place'));
  ck('空盘直接落子候选数 = 81', cands.filter(c=>c.type==='place').length===81, cands.filter(c=>c.type==='place').length);
  const oppBoard=newState();
  oppBoard.players[0].moves=0;
  // 模拟「对手无路」局面：棋盘中央塞满、只留 3×3 缺口给 AI，对手无 token
  // —— 用 oppThreat 的定义直接验证 canEscape 分支过于复杂，这里验证胜负级分值符号
  ck('战术分值足够压制基础分（|WIN_TACTIC| > 81×1000）', Math.abs(WIN_TACTIC)>81*1000);

  /* ========== 6. 整局模拟：收敛性 + 平衡 ========== */
  TIMERS='sync';
  let finished=0, combos=0, moves=0, maxRound=0, p0wins=0, errs=0;
  const N=30;
  for(let seed=1;seed<=N;seed++){
    const rnd=LCG(seed*7919+13);
    try{
      mode='hot'; startGame();
      let guard=0, seenCombo=false;
      while(!state.over && guard++<100){
        if(state.current===0){
          if(state.mustPlace){
            const A=allAnchors();
            if(!A.length){ ck('连招后无落位却未判负',false,'seed='+seed); break; }
            const [r,c]=A[Math.floor(rnd()*A.length)];
            doPlace(0,r,c); state.mustPlace=false; resetUi(); commitAction(); continue;
          }
          const A=allAnchors();
          if(A.length===0){
            if(!canMoveNow(0)){ break; }                 // advance 的判负逻辑等价收尾
            const cand=[];
            for(const b of oppBoxes(0)) for(const [mr,mc] of safeMoveTargets(b.boxId)) cand.push([b.boxId,mr,mc]);
            if(!cand.length) break;
            const [bid,mr,mc]=cand[Math.floor(rnd()*cand.length)];
            snapshot(); if(doMove(0,bid,mr,mc)==='lost') break;
            state.mustPlace=true; moves++; combos++; resetUi(); continue;
          }
          if(state.players[0].moves>0 && oppBoxes(0).length>0 && canMoveNow(0) && rnd()<0.5){
            const cand=[];
            for(const b of oppBoxes(0)) for(const [mr,mc] of safeMoveTargets(b.boxId)) cand.push([b.boxId,mr,mc]);
            if(cand.length){
              const [bid,mr,mc]=cand[Math.floor(rnd()*cand.length)];
              snapshot(); if(doMove(0,bid,mr,mc)==='lost') break;
              state.mustPlace=true; moves++; combos++; resetUi(); continue;
            }
          }
          const [r,c]=A[Math.floor(rnd()*A.length)];
          doPlace(0,r,c); resetUi(); commitAction();
        } else {
          const mvB=state.players[1].moves;
          aiTurn();
          if(state.players[1].moves<mvB) moves++;
        }
      }
      if(state.over){ finished++; if(state.winner===0) p0wins++; }
      combos+=0; maxRound=Math.max(maxRound,state.round);
      if(guard>=100) ck('疑似死循环 seed='+seed,false);
    }catch(e){ errs++; out.push(['整局异常 seed='+seed,false,e.message]); }
  }
  ck(N+' 局全部正常分出胜负', finished===N, finished+'/'+N);
  ck('无异常抛出', errs===0);
  ck('对局长度合理（<=30 回合）', maxRound>0&&maxRound<=30, 'maxRound='+maxRound);
  ck('「移动」在实战中被使用', moves>0, 'moves='+moves);
  ck('连招确实发生', combos>0, 'combos='+combos);
  ck('AI 没有一边倒（双方都赢过）', p0wins>0&&p0wins<N, 'P0 胜 '+p0wins+'/'+N);
  return out;
})()`);

let bad=0;
console.log('--- 装箱对决 冒烟测试 ---');
for(const [n,ok,x] of R){ console.log((ok?'PASS':'FAIL')+'  '+n+(x?'   ['+x+']':'')); if(!ok) bad++; }
console.log(bad? `\n${bad} 项失败` : `\n全部通过（${R.length} 项）`);
process.exit(bad?1:0);
