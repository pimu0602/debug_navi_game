/* Shared learning aids. State is supplied by the replay checkpoint, never hidden here. */
const PlanLearning=(()=>{
 const labels={
 stage1:['主電源','CP2','抵抗値'],stage2:['電源表示','CP2','DC24V'],stage3:['CPU一致','診断正常','I/O一致'],stage4:['PLC','リモートI/O','タッチパネル'],stage5:['センサーLED','X00','X01'],stage6:['非常停止押下','停止確認','入力一致'],stage7:['Y20指令','ランプA','ランプB'],stage8:['前進指令','前進方向','逆方向'],stage9:['原点指令','原点位置','原点完了'],stage10:['実行済み','完了検出','ワーク位置']};
 const probes={stage1:['CP2を切り離して抵抗を再測定','主電源の表示だけを見る'],stage2:['CP2を切り離して対象回路を確認','別のCPの表示だけを見る'],stage3:['I/O割付と実機の並びを照合','CPU型式だけを再確認'],stage4:['不通局の局番・配線・電源を確認','正常なPLCの表示だけを見る'],stage5:['センサーとPLC入力・配線を照合','センサーLEDだけを見る'],stage6:['非常停止接点とPLC入力を照合','準備ランプだけを見る'],stage7:['強制を解除して出力配線を照合','PLCの電源表示だけを見る'],stage8:['停止・遮断して配管と指令を照合','別の軸の外観だけを見る'],stage9:['原点位置・センサー・入力を照合','停止していることだけを見る'],stage10:['停止して履歴とワーク位置を照合','電源ランプだけを見る']};
 function shuffle(items,rng=Math.random){const out=items.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
 function indicators(id,abnormal,observed){return labels[id].map((label,i)=>({label,on:observed&&(abnormal?(id==='stage5'||id==='stage7'||id==='stage8'?i!==1:i===0):id==='stage5'||id==='stage7'||id==='stage8'?i!==2:true)}));}
 function reasons(id,abnormal,data){return shuffle([
 ['evidence',id==='stage1'?(abnormal?'切り離した後も抵抗値が残ったから':'切り離すと抵抗値が消えたから'):(abnormal?data.fault:data.good)],
 ['guess','前回も同じだったので、今回も同じだと思う'],
 ['appearance','作業が止まらず進んだので、確認内容に関係なく判断する']]);}
 return {shuffle,indicators,reasons,probes};
})();
if(typeof module!=='undefined')module.exports=PlanLearning;
