// ============================================================
// 効果音(WebAudioで自前生成。音声ファイル不要)
// ============================================================
const Sfx = (() => {
  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type = "square", vol = 0.15, when = 0) {
    if (!enabled) return;
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, c.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + when);
    o.stop(c.currentTime + when + dur + 0.02);
  }

  function noise(dur, vol = 0.2, when = 0) {
    if (!enabled) return;
    const c = ac();
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = vol;
    src.connect(g).connect(c.destination);
    src.start(c.currentTime + when);
  }

  return {
    setEnabled(v) { enabled = v; },
    isEnabled() { return enabled; },
    beep()   { tone(2000, 0.5, "sine", 0.18); },                 // テスター導通「ピー」
    click()  { noise(0.03, 0.25); },                              // CP・ブレーカー「カチッ」
    move()   { },                                                 // 歩行音は無しでOK
    warn()   { tone(220, 0.25, "square", 0.12); tone(180, 0.25, "square", 0.12, 0.28); }, // 警告
    error()  { tone(150, 0.5, "sawtooth", 0.15); },               // 中ミス
    smoke()  { noise(0.8, 0.25); tone(90, 0.9, "sawtooth", 0.18); tone(70, 1.2, "sawtooth", 0.12, 0.3); }, // 発煙
    pass()   { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "square", 0.12, i * 0.13)); }, // 合格
    fail()   { [400, 350, 300, 200].forEach((f, i) => tone(f, 0.3, "square", 0.1, i * 0.18)); },    // 不合格
    talk()   { tone(600, 0.05, "square", 0.08); },                // 会話ポポポ
    pickup() { tone(880, 0.1, "square", 0.12); tone(1320, 0.15, "square", 0.12, 0.1); } // アイテム取得
  };
})();
