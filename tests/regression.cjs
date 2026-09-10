const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {findWalkPath, procedureHit} = require('../js/navigation.js');

function game() {
  const elements = new Map();
  const makeElement = () => ({ innerHTML:'', textContent:'', value:'', options:[], style:{}, dataset:{},
    classList:{add(){},remove(){},contains(){return false;},toggle(){}},
    addEventListener(){}, querySelectorAll(){
      if (!this.innerHTML.includes('data-judgment')) return [];
      if(this._buttonHtml!==this.innerHTML) {
        this._buttonHtml=this.innerHTML;
        this._buttons=['normal','abnormal','investigate'].map(choice=>({dataset:{judgment:choice},textContent:choice}));
      }
      return this._buttons;
    }, appendChild(){}, replaceChildren(){},
    focus(){}, getContext(){return {};}, add(option){this.options.push(option);} });
  const document = { querySelector(selector){ if(!elements.has(selector)) elements.set(selector,makeElement()); return elements.get(selector); },
    querySelectorAll(){return [];}, addEventListener(){}, createElement:makeElement };
  const storage = new Map();
  const context = vm.createContext({ document, window:{addEventListener(){}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    setTimeout(){},setInterval(){},clearInterval(){}, console,
    Sfx:new Proxy({}, {get:()=>()=>{}}), Veteran:{resetCounts(){}}, Option:function(label,id){this.label=label;this.value=id;} });
  for (const file of ['data.js','stages.js','navigation.js','game.js']) vm.runInContext(fs.readFileSync(`${__dirname}/../js/${file}`,'utf8'),context);
  vm.runInContext(`G={stageId:'stage1',mode:'practice',stage:STAGES[0],startTime:Date.now(),
    cps:{CP1:true,CP2:true,CP3:false},cpEverOn:{},cpLog:[],actionLog:[],score:100,
    flags:{},noVolt:{'R-S':true,'S-T':true,'R-T':true},inventory:{tester:true,pen:true},
    contDone:new Set(),shortDone:new Set(),eDone:new Set(),markers:new Set(),
    mawariSeen:new Set(),mawariConfirmed:new Set(),defects:[],reports:[],missLog:[],missOnce:{},zumenOpened:true};
    updateChecklist=()=>{}; menuCP=()=>{};`,context);
  return {run:code=>vm.runInContext(code,context),elements};
}
test('route avoids an obstacle and reaches the goal',()=>{
  const blocked=(x,y)=>x>=40&&x<=60&&y<80;
  const path=findWalkPath({x:20,y:20},(x,y)=>x===80&&y===20,blocked,100,100);
  assert.ok(path.length); assert.ok(path.some(p=>p.y>=80));
  assert.ok(path.every(p=>!blocked(p.x,p.y)));
  assert.equal(findWalkPath({x:0,y:0},()=>false,()=>true,30,30),null);
});
test('every station is reachable from the player start and other stations',()=>{
  const g=game();
  assert.equal(g.run(`(() => {
    const goals=MAP_DEF.objects.filter(o=>o.interact);
    const starts=[{x:686,y:406}];
    for(const obj of goals) { const r=objRect(obj); const goal=(x,y)=>x+14>r.x-24&&x+14<r.x+r.w+24&&y+14>r.y-24&&y+14<r.y+r.h+24;
      for(const start of [...starts]) {const p=findWalkPath(start,goal,collides,canvas.width,canvas.height); if(!p)return false;}
      const p=findWalkPath(starts[0],goal,collides,canvas.width,canvas.height); starts.push(p.at(-1)||starts[0]);
    } return true;
  })()`),true);
});
test('diagnostic CP OFF is not recorded as final cleanup; all OFF after measurement is',()=>{
  const g=game();
  g.run("toggleCP('CP1');toggleCP('CP2')");
  assert.equal(g.run("G.actionLog.filter(l=>l.modelId==='cpoff').length"),0);
  g.run("G.contDone=new Set(S1_CONT_NETS);G.shortDone=new Set(S1_SHORT_PAIRS.map(p=>pairKey(...p)));G.eDone=new Set(S1_E_PAIRS.map(p=>pairKey(...p)));toggleCP('CP1');toggleCP('CP2');toggleCP('CP1')");
  assert.equal(g.run("G.actionLog.filter(l=>l.modelId==='cpoff').length"),0);
  g.run("toggleCP('CP2')");
  assert.equal(g.run("G.actionLog.filter(l=>l.modelId==='cpoff').length"),1);
  assert.equal(procedureHit([{modelId:'cpoff',t:10},{modelId:'cpoff',t:80}],'cpoff').t,80);
});
test('exam reading awaits judgment without completing a healthy measurement',()=>{
  const g=game();
  g.run("G.mode='exam';measureOhm(terminalById('R.b'),terminalById('R.k'),$('#tester-result'),$('#anomaly-area'))");
  assert.equal(g.run('G.contDone.size'),0);
  assert.equal(g.run('!!G.pendingJudgment'),true);
});
test('practice still registers healthy continuity and blocks CP-off measurements',()=>{
  const g=game();
  g.run("measureOhm(terminalById('R.b'),terminalById('R.k'),$('#tester-result'),$('#anomaly-area'))");
  assert.equal(g.run("G.contDone.has('R')"),true);
  g.run("G.cps.CP1=false;measureOhm(terminalById('L.b'),terminalById('L.k'),$('#tester-result'),$('#anomaly-area'))");
  assert.equal(g.run("G.contDone.has('L')"),false);
});
test('exam judgment accepts healthy results and rejects incorrect healthy claims',()=>{
  const g=game();
  g.run("G.mode='exam';measureOhm(terminalById('R.b'),terminalById('R.k'),$('#tester-result'),$('#anomaly-area'));$('#anomaly-area').querySelectorAll('button')[0].onclick()");
  assert.equal(g.run("G.contDone.has('R')"),true);
  g.run("G.defects=[{type:'break',target:'S',found:false}];measureOhm(terminalById('S.b'),terminalById('S.k'),$('#tester-result'),$('#anomaly-area'));$('#anomaly-area').querySelectorAll('button')[0].onclick()");
  assert.equal(g.run("G.contDone.has('S')"),false);
  assert.equal(g.run('G.score'),95);
  g.run("$('#anomaly-area').querySelectorAll('button')[1].onclick()");
  assert.equal(g.run("G.contDone.has('S') && G.defects[0].found"),true);
});
test('exam false reports remain false and cannot silently pass',()=>{
  const g=game();
  g.run("G.mode='exam';measureOhm(terminalById('R.b'),terminalById('R.k'),$('#tester-result'),$('#anomaly-area'));$('#anomaly-area').querySelectorAll('button')[1].onclick()");
  assert.equal(g.run('G.reports[0].defectIndex'),null);
});
test('exam can complete all continuity checks, including faults and backfeed diagnosis',()=>{
  const g=game();
  g.run(`G.mode='exam';G.defects=[{type:'break',target:'N',found:false},{type:'ground',target:'R',found:false}];
    function measureAndJudge(a,b,choice) {
      measureOhm(terminalById(a),terminalById(b),$('#tester-result'),$('#anomaly-area'));
      $('#anomaly-area').querySelectorAll('button')[choice].onclick();
    }
    for(const net of S1_CONT_NETS) measureAndJudge(net+'.b',net+'.k',net==='N'?1:0);
    for(const [a,b] of S1_SHORT_PAIRS) {
      const path=NORMAL_PATHS.find(p=>pairKey(p.a,p.b)===pairKey(a,b));
      measureAndJudge(a+'.b',b+'.b',path?2:0);
      if(path) { toggleCP(path.viaCp);measureAndJudge(a+'.b',b+'.b',0);toggleCP(path.viaCp); }
    }
    for(const [a,b] of S1_E_PAIRS) measureAndJudge(a+'.b',b+'.b',a==='R'?1:0);
    toggleCP('CP1');toggleCP('CP2');`);
  assert.equal(g.run('stage1ContDone() && stage1ShortDone() && cpAllOff()'),true);
  assert.equal(g.run('G.defects.every(d=>d.found)'),true);
  assert.equal(g.run('G.mawariConfirmed.size'),2);
  assert.equal(g.run("!!procedureHit(G.actionLog,'cpoff')"),true);
  assert.equal(g.run('G.reports.filter(r=>r.defectIndex===null).length'),0);
});
