const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../js/work-plan.js');
const valid={prep:'both',safety:'measure',cp:'needed'};
test('visible settings follow isolation, final checks and cleanup',()=>{
 let state=rules.emptyState();
 for(const step of rules.initial({...valid,range:'ohm'}))state=rules.viewState(state,step);
 assert.equal(state.main,false);assert.equal(state.cp1,true);assert.equal(state.cp2,true);
 assert.equal(state.range,'Ω');assert.equal(state.probes,'P盤側 ↔ 0V盤側');
 state=rules.viewState(state,rules.judge('isolate',false)[0]);
 assert.equal(state.cp2,false);assert.equal(state.reading,'0L（導通なし）');
 for(const step of rules.conclude('normal',false))state=rules.viewState(state,step);
 assert.equal(state.cp2,true);assert.equal(state.probes,'未接続');
 state=rules.viewState(state,rules.cleanup('off')[0]);
 assert.ok(!state.main&&!state.cp1&&!state.cp2&&!state.cp3);
});
test('restoring a decision snapshot removes energized and damaged state',()=>{
 let state=rules.emptyState();
 for(const step of rules.initial({...valid,range:'ohm'},true))state=rules.viewState(state,step);
 const saved={...state};
 for(const step of rules.judge('power',true))state=rules.viewState(state,step);
 assert.equal(state.main,true);assert.equal(state.reading,'故障');
 state=rules.viewState(state,{state:saved,reading:saved.reading});
 assert.deepEqual(state,saved);assert.equal(state.main,false);assert.equal(state.reading,'0.1 Ω');
});
test('energizing during resistance measurement produces damage in both scenarios',()=>{
 for(const shorted of [true,false]){
  const steps=rules.initial({...valid,safety:'power'},shorted);
  assert.equal(steps.at(-2).reading,'主電源 ON');
  assert.ok(steps.at(-1).fire && steps.at(-1).stop);
  assert.equal(steps.at(-1).effect,shorted?'panel':'meter');
 }
});
test('energizing an unresolved short burns; a normal path does not automatically burn',()=>{
 for(const phase of ['judge','cleanup']){
  assert.ok(rules[phase]('power',true).at(-1).fire);
  assert.ok(!rules[phase]('power',false).at(-1).fire);
  assert.ok(rules[phase]('power',false).at(-1).stop);
 }
});
test('wrong ranges on deenergized wiring stop without a fabricated fire',()=>{
 for(const range of ['amp','vac']){
  const result=rules.initial({...valid,range}).at(-1);
  assert.ok(result.stop);assert.ok(!result.fire);
 }
});
test('incomplete preparation and unsafe plans stop before resistance measurement',()=>{
 for(const a of [{...valid,prep:'tester'},{...valid,safety:'lever'},{...valid,cp:'all'},{...valid,cp:'off'}]){
  const steps=rules.initial(a);
  assert.ok(steps.at(-1).stop);
  assert.ok(!steps.some(s=>s.reading==='2.4 kΩ'));
 }
 assert.equal(rules.initial(valid).at(-1).decision,'reading');
});
test('both wiring scenarios require isolation and correct interpretation',()=>{
 for(const shorted of [true,false]){
  assert.ok(rules.judge('normal',shorted)[0].stop);
  assert.ok(rules.judge('short',shorted)[0].stop);
  const isolated=rules.judge('isolate',shorted)[0];
  assert.equal(isolated.decision,'conclusion');
  assert.equal(isolated.reading,shorted?'0.1 Ω':'0L（導通なし）');
  assert.equal(rules.conclude(shorted?'short':'normal',shorted).at(-1).decision,'cleanup');
  assert.ok(rules.conclude(shorted?'normal':'short',shorted)[0].stop);
 }
});
test('final cleanup remains required after diagnostic CP OFF',()=>{
 assert.ok(rules.cleanup('report')[0].stop);
 assert.ok(rules.cleanup('off')[0].done);
});
