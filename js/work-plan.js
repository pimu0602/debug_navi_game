/* Stage1の判断を短い場面で学ぶ独立モード。自由操作の状態・記録には触れない。 */
const PlanRules = {
  powerOn(shorted, measuring=false) {
    return [{place:'panel',title:'主電源ブレーカーをON',detail:'あなたの選択で通電しました。',reading:'主電源 ON'},
      shorted || measuring ? {stop:true,fire:true,title:shorted?'短絡箇所から発煙！':'テスターが故障・発煙！',detail:shorted?'未確認の短絡が残った回路に通電し、損傷が発生した想定です。異常を記録して原因を解消するまで通電せず、計画を見直しましょう。':'通電した回路を抵抗レンジで測り、テスターが損傷した想定です。抵抗測定の前に電源を切り、無電圧を確認する必要があります。',reading:'故障',effect:shorted?'panel':'meter'}:
      {stop:true,title:'確認完了前に通電してしまいました',detail:'この配線状態では発煙しませんでしたが、無電圧で行う導通確認を続けられません。燃えなかったことは、正しい手順だったことを意味しません。',reading:'主電源 ON'}];
  },
  initial(a, shorted=false) {
    const steps = [{place:'tools', title:'工具置き場へ移動', detail:'あなたの選択に沿って準備します。'}];
    if (a.prep !== 'both') return [...steps,{stop:true,title:'準備が足りません',detail:'測定にはテスター、異常の記録にはペンが必要です。両方を準備する計画に変えてみましょう。'}];
    steps.push({place:'desk',title:'テスターとペンを準備 → 図面を確認',detail:'今回の対象はP−0V間。CP2を経由する回路を確認しました。'});
    steps.push({place:'panel',title:'制御盤へ移動',detail:'導通を測る前の確認を実行します。'});
    if(a.safety === 'power') {
      const energized = this.powerOn(shorted && a.cp !== 'off',a.range !== 'vac');
      if(a.range === 'amp' && energized.at(-1).effect === 'meter') energized.at(-1).detail='通電した回路の2点間に電流レンジを当て、テスターが損傷した想定です。電流測定と電圧・抵抗測定では接続方法が異なります。計画を選び直しましょう。';
      return [...steps,{title:a.cp==='off'?'CPをすべてOFFのままにする':a.cp==='all'?'CPをすべてONにする':'CP1・CP2をONにする',detail:'選択したCPの状態を反映しました。'},...energized];
    }
    if(a.safety !== 'measure') return [...steps,{stop:true,title:'無電圧を確認できていません',detail:'レバーのOFF表示だけでは不十分です。主回路の相間3組をAC電圧レンジで確認する計画に変えましょう。抵抗測定はまだ実行しません。'}];
    steps.push({title:'レバーOFF → 相間3組をAC電圧測定',detail:'R−S / S−T / R−T：すべて0.00 V。無電圧を確認しました。',reading:'0.00 V'});
    if(a.cp !== 'needed') return [...steps,{stop:true,title:'CPの選択を見直しましょう',detail:a.cp==='off'?'CPをOFFのままでは、CPを通る配線を確認できません。図面に沿って必要なCP1・CP2をONにします。':'今回の導通確認でCP3をONにする必要はありません。必要なCP1・CP2だけを選びます。'}];
    if(a.range==='amp') return [...steps,{stop:true,title:'電流レンジでは導通を判断できません',detail:'今回は無電圧なので発煙しませんが、選んだ測定方法では必要な抵抗値を確認できません。測定の目的に合うレンジを選び直しましょう。',reading:'Aレンジ：判定不可'}];
    if(a.range==='vac') return [...steps,{stop:true,title:'0 Vでも配線が正しいとは限りません',detail:'電圧レンジで分かるのは電位差です。断線や短絡を確認するため、無電圧確認後に抵抗レンジへ切り替えましょう。',reading:'0.00 V'}];
    steps.push({title:'CP1・CP2をON → P−0V間を抵抗測定',detail:'抵抗値が見えました。ここで再生を止め、あなたの判断を待ちます。',reading:shorted?'0.1 Ω':'2.4 kΩ',decision:'reading'});
    return steps;
  },
  judge(choice,shorted) {
    if(choice==='power') return this.powerOn(shorted);
    if(choice!=='isolate') return [{stop:true,title:'この測定だけでは断定できません',detail:'抵抗値が見えても、回路を通した回り込みかもしれません。短絡・正常と決める前にCP2をOFFにして再測定しましょう。'}];
    return [{title:'CP2をOFFにして再測定',detail:shorted?'抵抗値が残っています。回路を切り離しても消えません。この結果をどう判断しますか？':'抵抗値が消えました。CP2を切り離す前の結果と比べて、どう判断しますか？',reading:shorted?'0.1 Ω':'0L（導通なし）',decision:'conclusion'}];
  },
  conclude(choice,shorted) {
    if((choice==='short')!==shorted) return [{stop:true,title:'再測定の結果と照合しましょう',detail:shorted?'CPをOFFにしても抵抗値が残りました。短絡の疑いとして記録する場面です。':'CPをOFFにすると抵抗値が消えました。短絡ではなく回り込みとして確認する場面です。'}];
    return [{title:shorted?'短絡の疑いとして記録':'回り込みとして確認',detail:'この判断場面は完了です。残りの導通確認は省略し、すべて完了した場面へ進みます。'},{title:'最後の後始末を選んでください',detail:'残りの確認に使ったCP1・CP2はONです。作業完了の前にどうしますか？',decision:'cleanup'}];
  },
  cleanup(choice,shorted=false) {
    if(choice==='power') return this.powerOn(shorted);
    return choice==='off'?[{done:true,title:'計画の検証が完了しました',detail:'確認後にCPをすべてOFFに戻して報告しました。途中の切り分けと最後の後始末を区別できました。'}]:[{stop:true,title:'後始末が残っています',detail:'切り分けで一度OFFにしていても、最後にすべてOFFか確認する必要があります。完了前の後始末を選び直しましょう。'}];
  }
};
if(typeof module !== 'undefined') module.exports = PlanRules;
if(typeof document !== 'undefined') {
const WorkPlan = (() => {
  let stage, root, timer, queue=[], index=0, paused=false, shorted=false, previous=null;
  let actor={x:82,y:78}, target={x:82,y:78}, log=[], lastAnswers={};
  const positions={tools:{x:18,y:57},desk:{x:46,y:78},panel:{x:78,y:30}};
  const questions=[['prep','準備するものは？',[['tester','テスターだけ'],['none','道具を持たずに現場へ'],['both','テスターとペンを準備し、図面を確認']]],['safety','抵抗測定の前に何をする？',[['lever','レバーのOFF表示だけ確認'],['power','主電源ブレーカーを入れて測定へ'],['measure','レバーOFFと、相間3組の無電圧を実測']]],['cp','導通確認に使うCPは？',[['all','すべてON'],['off','すべてOFFのまま'],['needed','図面に沿ってCP1・CP2だけON']]],['range','導通確認のレンジは？',[['vac','AC電圧レンジ'],['ohm','抵抗（Ω）レンジ'],['amp','電流（A）レンジ']]]];
  const el=s=>root.querySelector(s);
  function stop(){clearInterval(timer);timer=null;}
  function form(){
    stop(); const answers=lastAnswers;
    root.innerHTML=`<div class="plan-box"><h2>作業計画モード</h2><p>Stage1の要点を抜粋。3問で計画 → 自動再生 → 測定結果から追加判断。</p><p>初期状態：主電源はOFF。配線状態は選び直しても同じです。自由操作のスコアには入りません。</p><form id="plan-form">${questions.map(([id,q,opts])=>`<label class="plan-question">${q}<select required name="${id}"><option value="">選んでください</option>${opts.map(([v,t])=>`<option value="${v}" ${answers[id]===v?'selected':''}>${t}</option>`).join('')}</select></label>`).join('')}<button class="primary">この計画を再生</button></form><button id="plan-back">モード選択へ戻る</button><p>${previous?'前回：'+esc(previous):'結果は実行してから確認します。'}</p></div>`;
    el('#plan-form').onsubmit=e=>{e.preventDefault();const a=Object.fromEntries(new FormData(e.target));lastAnswers=a;play(PlanRules.initial(a,shorted));};
    el('.plan-box p').textContent='Stage1の要点を抜粋。4問で計画 → 自動再生 → 測定結果から追加判断。危険な操作では故障・発煙の演出が入ります。';
    el('#plan-back').onclick=()=>{stop();startBriefing(stage);};
    el('select').focus();
  }
  function play(steps){
    actor={x:82,y:78};target={...actor};log=[];
    root.innerHTML=`<div class="plan-box"><h2>あなたの計画をシミュレーション</h2><div class="plan-map" role="img" aria-label="選択した作業をキャラクターが自動実行する簡略工場"><span class="plan-station tools">工具置き場</span><span class="plan-station desk">図面・作業机</span><span class="plan-station panel">制御盤</span><span id="plan-actor" aria-hidden="true">👷</span><output id="plan-meter">測定前</output></div><div class="plan-controls"><button id="plan-pause">一時停止</button><label>再生速度 <select id="plan-speed"><option value="1">1倍</option><option value="2">2倍</option></select></label><button id="plan-edit">計画を選び直す</button><button id="plan-exit">モード選択へ</button></div><section id="plan-event" aria-live="polite"></section><div id="plan-choices"></div><details><summary>実行の記録</summary><ol id="plan-log"></ol></details></div>`;
    el('#plan-edit').onclick=()=>form();el('#plan-exit').onclick=()=>{stop();startBriefing(stage);};
    el('#plan-pause').onclick=()=>{paused=!paused;el('#plan-pause').textContent=paused?'再生を続ける':'一時停止';};
    paused=false;next(steps);
  }
  function next(steps){stop();queue=steps;index=0;advance();}
  function advance(){
    stop();const s=queue[index++];if(!s)return;
    if(s.place)target=positions[s.place];
    el('#plan-event').innerHTML=`<h3>${esc(s.title)}</h3><p>${esc(s.detail)}</p>`;
    el('#plan-choices').replaceChildren();
    log.push(s.title);el('#plan-log').innerHTML=log.map(t=>`<li>${esc(t)}</li>`).join('');
    if(s.reading)el('#plan-meter').textContent=s.reading;
    const map=el('.plan-map');
    map.classList.toggle('plan-burning',!!s.fire);
    map.querySelector('.plan-fire')?.remove();
    if(s.fire){const fx=document.createElement('div');fx.className='plan-fire '+s.effect;fx.textContent='🔥 💨';fx.setAttribute('aria-label','発煙・故障の演出');map.appendChild(fx);}
    let elapsed=0;
    el('#plan-pause').disabled=false;
    timer=setInterval(()=>{
      if(paused)return;
      const speed=Number(el('#plan-speed').value);elapsed+=50*speed;
      actor.x+=(target.x-actor.x)*0.06*speed;actor.y+=(target.y-actor.y)*0.06*speed;
      el('#plan-actor').style.left=actor.x+'%';el('#plan-actor').style.top=actor.y+'%';
      if(elapsed<3500)return;
      stop();
      if(s.decision||s.stop||s.done){el('#plan-pause').disabled=true;choices(s);}else advance();
    },50);
  }
  function choices(s){
    let opts=[];
    if(s.decision==='reading')opts=[['正常と判断',()=>next(PlanRules.judge('normal',shorted))],['短絡と判断',()=>next(PlanRules.judge('short',shorted))],['CP2をOFFにして再測定',()=>next(PlanRules.judge('isolate',shorted))]];
    if(s.decision==='reading')opts.push(['主電源ブレーカーを入れて様子を見る',()=>next(PlanRules.judge('power',shorted))]);
    if(s.decision==='conclusion')opts=[['回り込みとして確認',()=>next(PlanRules.conclude('normal',shorted))],['短絡の疑いとして記録',()=>next(PlanRules.conclude('short',shorted))]];
    if(s.decision==='cleanup')opts=[['CPをすべてOFFに戻して報告',()=>next(PlanRules.cleanup('off'))],['このまま報告',()=>next(PlanRules.cleanup('report'))]];
    if(s.decision==='cleanup')opts.push(['主電源ブレーカーを入れる',()=>next(PlanRules.cleanup('power',shorted))]);
    if(s.stop||s.done){previous=s.title;opts=[['同じ配線状態で選び直す',()=>form()]];if(s.done)opts.push(['別の配線状態に挑戦',()=>{shorted=!shorted;previous=null;form();}]);}
    opts.forEach(([label,action])=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;el('#plan-choices').appendChild(b);});
    el('#plan-choices button')?.focus();
  }
  return {open(st){stage=st;shorted=Math.random()<0.5;previous=null;root=document.querySelector('#screen-plan');if(!root){root=document.createElement('div');root.id='screen-plan';root.className='screen';document.querySelector('#app').appendChild(root);}show('screen-plan');form();}};
})();
window.WorkPlan=WorkPlan;
}
