const test=require('node:test');
const assert=require('node:assert/strict');
const learning=require('../js/plan-learning');
const scenarios=require('../js/plan-scenarios');
test('shuffling preserves choices without mutating source',()=>{
 const values=['a','b','c'];const result=learning.shuffle(values,()=>0);
 assert.deepEqual(values,['a','b','c']);assert.deepEqual(result.slice().sort(),values);assert.notDeepEqual(result,values);
});
test('released outputs cannot become residual outputs on a later choice',()=>{
 const s=scenarios.create('stage7');const inspected=s.decide('inspect',true)[0];
 assert.equal(inspected.state.forceReleased,true);
 const result=s.decide('danger',true,inspected.state).at(-1);
 assert.match(result.detail,/すでに解除済み/);assert.ok(!result.fire);
 assert.equal(s.finish('report',true)[0].state.forceReleased,true);
});
test('normal reports and danger choices never invent an existing defect',()=>{
 for(const id of scenarios.ids){const s=scenarios.create(id);
  assert.doesNotMatch(s.finish('report',false)[0].detail,/配線不一致|異常回路|未解決/);
  assert.match(s.decide('danger',false).at(-1).detail,/異常は確認されていません/);
 }
});
test('all stages offer investigation and fact-based reasons',()=>{
 for(let i=1;i<=10;i++){const id='stage'+i;assert.equal(learning.probes[id].length,2);
  for(const fault of [false,true]){const reasons=learning.reasons(id,fault,scenarios.create(id)?.data);assert.equal(reasons.filter(r=>r[0]==='evidence').length,1);}
 }
});
test('unobserved machines do not leak random fault state',()=>{
 for(let i=1;i<=10;i++){const id='stage'+i;assert.deepEqual(learning.indicators(id,false,false),learning.indicators(id,true,false));}
});
