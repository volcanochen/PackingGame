#!/usr/bin/env node
/* 临时校验：非默认棋盘/方块尺寸下，引擎是否正常 */
'use strict';
const fs=require('fs'), path=require('path'), vm=require('vm');
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
global.setTimeout=fn=>{ fn(); return 0; };
global.clearTimeout=()=>{};

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
vm.runInThisContext(html.match(/<script>([\s\S]*?)<\/script>/)[1]);

const out=vm.runInThisContext(`(function(){
  const res=[];
  const cases=[[12,4,81],[16,5,144],[12,3,100],[15,4,144],[18,3,256],[13,5,81],[18,5,196]];
  for(const [bs,piece,expect] of cases){
    CONFIG.boardSize=bs; CONFIG.piece=piece; recalcDims();
    mode='hot'; startGame();
    const got=allAnchors().length;
    res.push(['BS='+bs+' P='+piece+' MAXA='+MAXA+' 锚点='+got, got===expect, got+'/'+expect]);
    res.push(['  board 数组行数='+state.board.length, state.board.length===bs, state.board.length]);
    res.push(['  board 每行格数='+state.board[0].length, state.board[0].length===bs, state.board[0].length]);
  }
  // 非默认尺寸下跑数局到分出胜负（模拟走法照抄已验证过的 smoke.js 流程）
  const runGame=(bs,piece,seed)=>{
    CONFIG.boardSize=bs; CONFIG.piece=piece; recalcDims();
    mode='hot'; startGame();
    let x=seed>>>0; const rnd=()=>{x=(x*1664525+1013904223)>>>0; return x/4294967296;};
    let guard=0, pl=0, cb=0;
    while(!state.over && guard++<300){
      if(state.current===0){
        if(state.mustPlace){
          const A=allAnchors(); if(!A.length) break;
          snapshot(); const t=A[Math.floor(rnd()*A.length)];
          doPlace(0,t[0],t[1]); pl++; state.mustPlace=false; resetUi(); commitAction(); continue;
        }
        const A=allAnchors();
        if(A.length===0){
          if(!canMoveNow(0)) break;
          const cand=[];
          for(const b of oppBoxes(0)) for(const [mr,mc] of safeMoveTargets(b.boxId)) cand.push([b.boxId,mr,mc]);
          if(!cand.length) break;
          const t=cand[Math.floor(rnd()*cand.length)];
          snapshot(); if(doMove(0,t[0],t[1],t[2])==='lost') break;
          state.mustPlace=true; cb++; resetUi(); continue;
        }
        if(state.players[0].moves>0 && oppBoxes(0).length>0 && canMoveNow(0) && rnd()<0.5){
          const cand=[];
          for(const b of oppBoxes(0)) for(const [mr,mc] of safeMoveTargets(b.boxId)) cand.push([b.boxId,mr,mc]);
          if(cand.length){
            const t=cand[Math.floor(rnd()*cand.length)];
            snapshot(); if(doMove(0,t[0],t[1],t[2])==='lost') break;
            state.mustPlace=true; cb++; resetUi(); continue;
          }
        }
        snapshot(); const t=A[Math.floor(rnd()*A.length)];
        doPlace(0,t[0],t[1]); pl++; resetUi(); commitAction();
      } else { aiTurn(); }
    }
    return {over:state.over, winner:state.winner, round:state.round, placed:pl, combos:cb};
  };
  for(const [bs,piece] of [[16,5],[12,3],[18,3],[15,4],[18,5],[13,5]]){
    let ok=true, note=[];
    for(let s=1;s<=3;s++){
      const r=runGame(bs,piece,s*31+7);
      if(!r.over) ok=false;
      note.push('R'+r.round+'/落'+r.placed+'/连'+r.combos+'胜'+(r.winner===0?'P0':r.winner===1?'P1':'?'));
    }
    res.push([bs+'×'+bs+' / '+piece+'×'+piece+' 3 局均正常分胜负', ok, note.join('  ')]);
  }
  // 移动 token 规则跟随配置
  CONFIG.boardSize=12; CONFIG.piece=4; CONFIG.moveEvery=1; CONFIG.moveMax=2; CONFIG.secondStartMove=0;
  recalcDims(); mode='hot'; startGame();
  doPlace(0,0,0);
  res.push(['moveEvery=1：每放1个即得token', state.players[0].moves===1, state.players[0].moves]);
  res.push(['secondStartMove=0：后手无补偿', state.players[1].moves===0, state.players[1].moves]);
  return res;
})()`);
let bad=0;
for(const [n,ok,x] of out){ console.log((ok?'PASS':'FAIL')+'  '+n+(x!==''?'   ['+x+']':'')); if(!ok) bad++; }
console.log(bad? `\n${bad} 项失败` : `\n尺寸参数校验全部通过（${out.length} 项）`);
process.exit(bad?1:0);
