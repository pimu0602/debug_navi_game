const test=require('node:test');
const assert=require('node:assert/strict');
const scenarios=require('../js/plan-scenarios.js');
const valid={prep:'ready',method:'step',check:'observe'};
test('all remaining stages have their own training scenario',()=>{
 assert.deepEqual(scenarios.ids,Array.from({length:9},(_,i)=>'stage'+(i+2)));
 assert.equal(scenarios.create('stage1'),null);
 assert.equal(new Set(scenarios.ids.map(id=>scenarios.create(id).data.good)).size,9);
});
for(const id of scenarios.ids){
 test(id+' normal and abnormal observations reach distinct reports',()=>{
  const s=scenarios.create(id);
  for(const abnormal of [false,true]){
   const initial=s.initial(valid,abnormal);
   assert.equal(initial.at(-1).decision,'scenario');
   assert.equal(initial.at(-1).detail,abnormal?s.data.fault:s.data.good);
   assert.ok(!initial.some(step=>step.done));
   assert.ok(s.decide(abnormal?'normal':'abnormal',abnormal)[0].stop);
   const inspected=s.decide('inspect',abnormal)[0];
   assert.equal(inspected.decision,'scenario-confirm');
   assert.equal(inspected.detail,abnormal?s.data.detailFault:s.data.detailGood);
   assert.equal(s.decide(abnormal?'abnormal':'normal',abnormal)[0].decision,'scenario-finish');
   assert.ok(s.finish('skip',abnormal)[0].stop);
   assert.ok(s.finish('report',abnormal)[0].done);
   if(abnormal)assert.match(s.finish('report',true)[0].detail,/修理完了を意味するものではありません/);
  }
 });
 test(id+' skipped steps and dangerous actions stop the scenario',()=>{
  const s=scenarios.create(id);
  for(const a of [{...valid,prep:'skip'},{...valid,prep:'guess'},{...valid,method:'skip'},{...valid,method:'risky'},{...valid,check:'skip'},{...valid,check:'guess'}]){
   const result=s.initial(a,true).at(-1);assert.ok(result.stop);assert.ok(!result.done);
  }
  const danger=s.decide('danger',true).at(-1);
  assert.ok(danger.stop);assert.ok(danger.cause.length);
  assert.equal(!!danger.fire,id==='stage2');
 });
}
