const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../js/work-plan.js');
const valid={prep:'both',safety:'measure',cp:'needed'};
test('progress advances through the plan and stops at the actual failed phase',()=>{
 let phase='preparation';
 for(const step of rules.initial(valid))phase=rules.phase(phase,step);
 assert.equal(phase,'judgment');
 phase=rules.phase(phase,rules.conclude('normal',false).at(-1));
 assert.equal(phase,'cleanup');
 assert.equal(rules.phase(phase,rules.cleanup('off')[0]),'complete');
 phase='preparation';
 for(const step of rules.initial({...valid,safety:'lever'}))phase=rules.phase(phase,step);
 assert.equal(phase,'safety');
});
test('predictions compare with actual outcomes without changing simulation outcomes',()=>{
 for(const [step,expected] of [[rules.initial(valid).at(-1),'reading'],[rules.initial({...valid,prep:'none'}).at(-1),'stop'],[rules.powerOn(true).at(-1),'damage']]){
  for(const predicted of ['reading','stop','damage']){
   const result=rules.predictionResult(step,predicted);
   assert.equal(result.actual,expected);assert.equal(result.match,predicted===expected);
  }
 }
});
test('reflection distinguishes panel damage, tester damage and final cleanup',()=>{
 assert.match(rules.lesson(rules.powerOn(true).at(-1),valid),/通電しない/);
 assert.match(rules.lesson(rules.powerOn(false,true).at(-1),valid),/無電圧/);
 assert.match(rules.lesson(rules.cleanup('off')[0],valid),/別の確認/);
});
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
