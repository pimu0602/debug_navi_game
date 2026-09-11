const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../js/work-plan.js');
const valid={prep:'both',safety:'measure',cp:'needed'};
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
