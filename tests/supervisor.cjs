const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Supervisor=require('../js/supervisor');
test('all ten stages have distinct advice for each phase with deeper guidance',()=>{
 assert.equal(Supervisor.stages.length,10);
 for(const phase of ['preparation','safety','measurement','judgment','cleanup','complete']){
  const first=Supervisor.stages.map(id=>{const hints=Supervisor.hints(id,phase);assert.ok(hints.length>=3);assert.equal(new Set(hints).size,hints.length);return hints[0];});
  assert.equal(new Set(first).size,10);
 }
});
test('advice uses visible observations and failure lessons without hidden defects',()=>{
 assert.match(Supervisor.hints('stage7','judgment',{reading:'強制解除済み'}).at(-1),/強制解除済み/);
 assert.match(Supervisor.hints('stage8','measurement',{stop:true,lesson:'方向を確認する'})[0],/方向を確認する/);
 assert.doesNotMatch(Supervisor.hints('stage4','preparation').join(''),/短絡|抵抗レンジ/);
});
test('free-operation fallback provides deeper stage-specific advice',async()=>{
 const context=vm.createContext({Supervisor,localStorage:{getItem:()=>null},console});
 vm.runInContext(fs.readFileSync(require.resolve('../js/npc.js'),'utf8')+'\nglobalThis.npc=Veteran;',context);
 const state={stageId:'stage7',progress:'0/5',zumenOpened:false};
 const answers=[];for(let i=0;i<3;i++)answers.push((await context.npc.ask(state,[],'ヒント')).text);
 assert.match(answers[0],/出力番号/);assert.equal(new Set(answers).size,3);
 const other=await context.npc.ask({...state,stageId:'stage4'},[],'ヒント');assert.match(other.text,/ネットワーク構成図/);
});
