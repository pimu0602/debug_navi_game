// ============================================================
// デバッグナビ(仮称) ゲーム本体
// data.js / audio.js / npc.js を読み込んだ後に実行される
// ============================================================
"use strict";

// ---------------- ユーティリティ ----------------
const $ = (sel) => document.querySelector(sel);
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function pairKey(a, b) { return [a, b].sort().join("-"); }
function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 用語に下線を付ける(各用語、テキスト中の最初の1回だけ)
function linkTerms(text) {
  let html = esc(text);
  const terms = (G && G.stage.terms) ? G.stage.terms : Object.keys(GLOSSARY);
  for (const t of terms) {
    if (!GLOSSARY[t]) continue;
    const idx = html.indexOf(t);
    if (idx === -1) continue;
    // 既にspan内なら飛ばす(簡易判定: 直前に data-term があるか)
    html = html.slice(0, idx) + `<span class="term" data-term="${esc(t)}">${esc(t)}</span>` + html.slice(idx + t.length);
  }
  return html;
}

// ---------------- 画面切替 ----------------
function show(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  $("#" + id).classList.add("active");
}
function openModal(id) { $("#" + id).classList.add("active"); }
function closeModal(id) { $("#" + id).classList.remove("active"); }
function closeAllModals() {
  document.querySelectorAll(".overlay").forEach(o => o.classList.remove("active"));
}
function anyModalOpen() {
  return [...document.querySelectorAll(".overlay")].some(o => o.classList.contains("active"));
}

// トースト表示
function toast(text, warn = false, ms = 4200) {
  const div = document.createElement("div");
  div.className = "toast" + (warn ? " warn" : "");
  div.innerHTML = linkTerms(text);
  $("#toast-area").appendChild(div);
  setTimeout(() => div.remove(), ms);
}

// ---------------- 記録(localStorage) ----------------
function loadRecords() {
  try { return JSON.parse(localStorage.getItem("dn_records") || "{}"); } catch { return {}; }
}
function saveRecord(stageId, rec) {
  const all = loadRecords();
  if (!all[stageId]) all[stageId] = [];
  all[stageId].push(rec);
  localStorage.setItem("dn_records", JSON.stringify(all));
}
function bestRecord(stageId) {
  const list = loadRecords()[stageId] || [];
  const passes = list.filter(r => r.pass);
  if (!passes.length) return null;
  return passes.reduce((a, b) => (b.score > a.score ? b : a));
}

// ---------------- グローバル状態 ----------------
let G = null;
let loopId = null;
const keys = {};

// ---------------- タイトル / ステージ選択 ----------------
function renderStageSelect() {
  const grid = $("#stage-grid");
  grid.innerHTML = "";
  for (const st of STAGES) {
    const card = document.createElement("div");
    card.className = "stage-card" + (st.unlocked ? "" : " locked");
    if (st.unlocked) card.tabIndex = 0;
    const best = st.unlocked ? bestRecord(st.id) : null;
    const plays = (loadRecords()[st.id] || []).length;
    card.innerHTML = `
      <div class="num">STAGE ${st.num}</div>
      <div class="name">${esc(st.title)}</div>
      <div class="sub">${esc(st.subtitle)}${st.unlocked ? "" : "(準備中)"}</div>
      ${best ? `<div class="best">★合格済み ベスト${best.score}点 / プレイ${plays}回</div>`
             : (plays ? `<div class="best" style="color:var(--dim)">プレイ${plays}回(未合格)</div>` : "")}
    `;
    if (st.unlocked) {
      card.onclick = () => startBriefing(st);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter") { startBriefing(st); e.preventDefault(); } });
    }
    grid.appendChild(card);
  }
  const first = grid.querySelector(".stage-card:not(.locked)");
  if (first) setTimeout(() => first.focus(), 0);
}

// ---------------- 不良のランダム生成 ----------------
function generateDefects(stage) {
  const [min, max] = stage.defectCountRange;
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const defects = [];
  const usedTypes = new Set();
  const usedNets = new Set();
  let guard = 0;
  while (defects.length < count && guard++ < 60) {
    const spec = randPick(stage.defectPool);
    if (usedTypes.has(spec.type)) continue; // 同種は1件まで
    const p = randPick(spec.pool);
    const netsInvolved = Array.isArray(p) ? p : [p];
    if (netsInvolved.some(n => usedNets.has(n))) continue; // 同じ線番に重ねない
    usedTypes.add(spec.type);
    netsInvolved.forEach(n => usedNets.add(n));
    defects.push({ type: spec.type, target: p, name: spec.name(p), lesson: spec.lesson, found: false });
  }
  return defects;
}

// ---------------- ステージ開始 ----------------
function startBriefing(stage) {
  const box = $("#brief-box");
  box.innerHTML = `<h2>STAGE ${stage.num} ${esc(stage.title)}</h2>` +
    stage.briefing.map(l => `<p>${linkTerms(l)}</p>`).join("") +
    `<p style="color:var(--accent)">目標:${linkTerms(stage.goalText)}</p>` +
    `<div class="footer"><button id="brief-start" class="primary">現場に入る</button>
     <button id="brief-back">戻る</button></div>`;
  show("screen-brief");
  $("#brief-start").onclick = () => startStage(stage);
  $("#brief-back").onclick = () => { renderStageSelect(); show("screen-select"); };
  setTimeout(() => $("#brief-start").focus(), 0);
}

function startStage(stage) {
  G = {
    stage, stageId: stage.id,
    startTime: Date.now(),
    score: 100,
    player: { x: MAP_DEF.playerStart.x * MAP_DEF.tile + 6, y: MAP_DEF.playerStart.y * MAP_DEF.tile + 6, dir: "up" },
    inventory: { tester: false, pen: false },
    testerBroken: false,
    zumenOpened: false,
    flags: { leverChecked: false, mainOn: false, sourceOn: false, safetyChecked: false },
    cps: { CP1: false, CP2: false, CP3: false },
    cpEverOn: { CP1: false, CP2: false, CP3: false }, // OFFに戻してもチェックリスト表示は保持
    cpLog: [],
    mawariSeen: new Set(),      // CP ONで回り込みの抵抗値を見たペア(Step10のCP OFF再確認を許可する)
    mawariConfirmed: new Set(), // CP OFFで消えることを確認済みのペア(模範手順Step10)
    noVolt: {},          // "R-S" -> true
    contDone: new Set(), // 線番id
    shortDone: new Set(),// pairKey
    eDone: new Set(),    // pairKey
    voltDone: new Set(), // stage2 電圧確認 pairKey
    lampChecked: {},     // stage2 CPid -> true
    quarantined: {},     // stage2 CPid -> true(異常で使用中止)
    markers: new Set(),  // 図面マーカー
    doneSteps: new Set(),// 汎用ステージ(Stage3〜10)の完了項目
    defects: GENERIC_STAGES[stage.id] ? [] : generateDefects(stage),
    reports: [],         // {key, desc, defectIndex(null=誤記録)}
    pendingAnomaly: null,
    missLog: [],
    missOnce: {},        // 同じ中/軽ミスを繰り返し取らないためのフラグ
    actionLog: [],
    npcCalls: 0,
    chatHistory: [],
    checkpoint: null,
    checkpointName: "ステージ開始",
    range: "ohm",
  };
  // 汎用ステージ(Stage3〜10)の初期化
  const gen = GENERIC_STAGES[stage.id];
  if (gen) {
    G.flags.sourceOn = !!gen.initial.sourceOn;
    G.flags.mainOn = !!gen.initial.mainOn;
    if (gen.initial.cps) G.cps = { ...gen.initial.cps };
    G.defects = generateGenericDefects(gen);
    stage.modelProcedure = genericModelProcedure(gen);
  }
  Veteran.resetCounts();
  logAction("現場に入った", null);
  $("#hud-stage-name").textContent = `STAGE ${stage.num} ${stage.title}`;
  show("screen-game");
  closeAllModals();
  if (!localStorage.getItem("dn_tutorial_seen")) {
    openTutorial();
    localStorage.setItem("dn_tutorial_seen", "1");
  }
  startLoop();
}

function logAction(text, modelId) {
  if (!G) return;
  G.actionLog.push({ t: Math.floor((Date.now() - G.startTime) / 1000), text, modelId: modelId || null });
}

// ---------------- ミス処理 ----------------
function missLight(key, text) {
  if (G.missOnce[key]) return;
  G.missOnce[key] = true;
  G.score = Math.max(0, G.score - 5);
  G.missLog.push({ level: "軽", text });
  logAction(`【軽ミス】${text}`, null);
  Sfx.warn();
  toast(`⚠ ${text}(軽ミス -5点)`, true);
}
function missMid(key, text, detail) {
  if (key && G.missOnce[key]) { return; }
  if (key) G.missOnce[key] = true;
  G.score = Math.max(0, G.score - 15);
  G.missLog.push({ level: "中", text });
  logAction(`【中ミス】${text}`, null);
  Sfx.error();
  toast(`⚠⚠ ${text}(中ミス -15点)${detail ? "<br>" + detail : ""}`, true, 6000);
}
function missBig(text, lesson, fireAt) {
  G.score = Math.max(0, G.score - 30);
  G.missLog.push({ level: "大", text });
  logAction(`【大ミス】${text}`, null);
  Sfx.smoke();
  closeAllModals();
  // まず現場(盤や装置)が3秒燃える → その後に結果表示
  const objId = fireAt || (gdef() && gdef().fireAt) || "panel";
  const obj = MAP_DEF.objects.find(o => o.id === objId) || MAP_DEF.objects.find(o => o.id === "panel");
  const r = objRect(obj);
  const parts = [];
  for (let i = 0; i < 18; i++) {
    parts.push({ x: r.x + 8 + Math.random() * (r.w - 16), y: r.y + r.h - 8, phase: Math.random(), size: 6 + Math.random() * 10, smoke: i % 3 === 0 });
  }
  G.fireAnim = { until: Date.now() + 3000, rect: r, parts, pending: { text, lesson } };
}
function showSmokeOverlay(text, lesson) {
  const ov = $("#smoke-overlay");
  $("#smoke-text").textContent = text;
  $("#smoke-lesson").innerHTML = linkTerms("実機なら:" + lesson);
  $("#smoke-checkpoint").textContent = `チェックポイント「${G.checkpointName}」からやり直し(-30点)`;
  ov.classList.add("active");
}

function makeCheckpoint(name) {
  G.checkpointName = name;
  G.checkpoint = {
    doneSteps: [...(G.doneSteps || [])],
    flags: { ...G.flags },
    cps: { ...G.cps },
    cpEverOn: { ...G.cpEverOn },
    cpLog: [...G.cpLog],
    noVolt: { ...G.noVolt },
    contDone: [...G.contDone],
    shortDone: [...G.shortDone],
    eDone: [...G.eDone],
    mawariSeen: [...G.mawariSeen],
    mawariConfirmed: [...G.mawariConfirmed],
    voltDone: [...G.voltDone],
    lampChecked: { ...G.lampChecked },
    quarantined: { ...G.quarantined },
    markers: [...G.markers],
    reports: JSON.parse(JSON.stringify(G.reports)),
    defectsFound: G.defects.map(d => d.found),
    inventory: { ...G.inventory },
    testerBroken: G.testerBroken,
  };
  toast(`✔ チェックポイント:${name}`);
  logAction(`チェックポイント到達:${name}`, null);
}
function restoreCheckpoint() {
  const c = G.checkpoint;
  if (!c) { // ステージ最初から
    const st = G.stage;
    const keepScore = G.score, keepMiss = G.missLog, keepLog = G.actionLog, keepStart = G.startTime, keepDefects = G.defects, keepChat = G.chatHistory, keepCalls = G.npcCalls;
    startStage(st);
    G.score = keepScore; G.missLog = keepMiss; G.actionLog = keepLog; G.startTime = keepStart; G.defects = keepDefects; G.chatHistory = keepChat; G.npcCalls = keepCalls;
    logAction("最初からやり直し", null);
    return;
  }
  G.doneSteps = new Set(c.doneSteps || []);
  G.flags = { ...c.flags };
  G.cps = { ...c.cps };
  G.cpEverOn = { ...(c.cpEverOn || G.cpEverOn) };
  G.cpLog = [...c.cpLog];
  G.noVolt = { ...c.noVolt };
  G.contDone = new Set(c.contDone);
  G.shortDone = new Set(c.shortDone);
  G.eDone = new Set(c.eDone);
  G.mawariSeen = new Set(c.mawariSeen || []);
  G.mawariConfirmed = new Set(c.mawariConfirmed || []);
  G.voltDone = new Set(c.voltDone);
  G.lampChecked = { ...c.lampChecked };
  G.quarantined = { ...c.quarantined };
  G.markers = new Set(c.markers);
  G.reports = JSON.parse(JSON.stringify(c.reports));
  G.defects.forEach((d, i) => d.found = c.defectsFound[i]);
  G.inventory = { ...c.inventory };
  G.testerBroken = c.testerBroken;
  G.pendingAnomaly = null;
  logAction(`チェックポイント「${G.checkpointName}」から再開`, null);
}
$("#smoke-ok").onclick = () => {
  $("#smoke-overlay").classList.remove("active");
  restoreCheckpoint();
};

// ---------------- マップ描画・移動 ----------------
const canvas = $("#map");
const ctx = canvas.getContext("2d");
const T = MAP_DEF.tile;
canvas.width = MAP_DEF.cols * T;
canvas.height = MAP_DEF.rows * T;

function objRect(o) { return { x: o.x * T, y: o.y * T, w: o.w * T, h: o.h * T }; }

function drawMap() {
  // 床
  for (let r = 0; r < MAP_DEF.rows; r++) {
    for (let c = 0; c < MAP_DEF.cols; c++) {
      ctx.fillStyle = (r + c) % 2 ? "#2a2d36" : "#262932";
      ctx.fillRect(c * T, r * T, T, T);
    }
  }
  // 通路ライン(工場っぽさ)
  ctx.strokeStyle = "#e8c84044";
  ctx.lineWidth = 3;
  ctx.strokeRect(T * 0.5, T * 0.5, canvas.width - T, canvas.height - T);

  // 配置物
  for (const o of MAP_DEF.objects) {
    const r = objRect(o);
    ctx.fillStyle = o.color;
    ctx.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
    ctx.strokeStyle = "#00000055";
    ctx.strokeRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);

    // ちょい足しの見た目
    if (o.id === "panel") {
      // 制御盤: 扉+ランプ+ブレーカー
      ctx.fillStyle = "#3e6350";
      ctx.fillRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
      const lampColors = G && G.flags.mainOn ? ["#ff5050", "#50ff50", "#f5c542"] : ["#5a3030", "#305a30", "#5a5230"];
      lampColors.forEach((col, i) => {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(r.x + 24 + i * 18, r.y + 20, 5, 0, Math.PI * 2);
        ctx.fill();
      });
      // ブレーカーレバー
      ctx.fillStyle = "#222";
      ctx.fillRect(r.x + r.w - 42, r.y + 14, 26, 34);
      ctx.fillStyle = G && G.flags.mainOn ? "#e05050" : "#888";
      ctx.fillRect(r.x + r.w - 38, G && G.flags.mainOn ? r.y + 18 : r.y + 32, 18, 10);
      // 端子台
      ctx.fillStyle = "#c9c9c9";
      for (let i = 0; i < 8; i++) ctx.fillRect(r.x + 14 + i * 12, r.y + r.h - 22, 8, 12);
    }
    if (o.id === "tools") {
      ctx.fillStyle = "#5d4a2a";
      ctx.fillRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
      // テスター(取ったら消える)
      if (!G || !G.inventory.tester) {
        ctx.fillStyle = "#d8c840";
        ctx.fillRect(r.x + 14, r.y + 16, 20, 28);
        ctx.fillStyle = "#101408";
        ctx.fillRect(r.x + 17, r.y + 20, 14, 9);
      }
      if (!G || !G.inventory.pen) {
        ctx.fillStyle = "#e05050";
        ctx.fillRect(r.x + 46, r.y + 20, 5, 24);
      }
    }
    if (o.id === "desk") {
      ctx.fillStyle = "#6d5a42";
      ctx.fillRect(r.x + 8, r.y + 8, r.w - 16, r.h - 16);
      ctx.fillStyle = "#e8e6dc";
      ctx.fillRect(r.x + 18, r.y + 18, 42, 30); // 図面
      ctx.strokeStyle = "#4060a0";
      ctx.strokeRect(r.x + 22, r.y + 24, 34, 4);
      ctx.strokeRect(r.x + 22, r.y + 34, 34, 4);
    }
    if (o.id === "pc") {
      ctx.fillStyle = "#222a3a";
      ctx.fillRect(r.x + 8, r.y + 6, r.w - 16, r.h - 14);
      ctx.fillStyle = "#7fc0ff";
      ctx.fillRect(r.x + 12, r.y + 9, r.w - 24, r.h - 22);
    }
    if (o.id === "machine") {
      ctx.fillStyle = "#5a6455";
      ctx.fillRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
      // シリンダ
      ctx.fillStyle = "#b8b8c0";
      ctx.fillRect(r.x + 14, r.y + 20, 42, 10);
      ctx.fillStyle = "#d0a030";
      ctx.fillRect(r.x + 56, r.y + 22, 14, 6);
      // ロボットアーム
      ctx.strokeStyle = "#e0e0e0";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(r.x + r.w - 34, r.y + r.h - 16);
      ctx.lineTo(r.x + r.w - 52, r.y + 28);
      ctx.lineTo(r.x + r.w - 24, r.y + 18);
      ctx.stroke();
      ctx.lineWidth = 1;
      // 状態ランプ
      ctx.fillStyle = (G && G.flags.mainOn) ? "#50e050" : "#3a4a3a";
      ctx.beginPath(); ctx.arc(r.x + 16, r.y + r.h - 16, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (o.id === "npc") {
      // ベテラン: ヘルメット白
      ctx.fillStyle = "#e8e8e8";
      ctx.beginPath(); ctx.arc(r.x + T / 2, r.y + 12, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#405068";
      ctx.fillRect(r.x + T / 2 - 8, r.y + 18, 16, 18);
    }
    if (o.id === "wallpower") {
      ctx.fillStyle = "#333";
      ctx.fillRect(r.x + 10, r.y + 8, r.w - 20, r.h - 12);
      ctx.fillStyle = G && G.flags.sourceOn ? "#50e050" : "#666";
      ctx.fillRect(r.x + r.w / 2 - 5, r.y + 14, 10, 14);
    }
    // ラベル
    ctx.fillStyle = "#e8e6dccc";
    ctx.font = "11px sans-serif";
    ctx.fillText(o.label, r.x + 4, r.y + r.h + 12 > canvas.height ? r.y - 4 : r.y + r.h + 12);
  }

  // 炎上演出(大ミス時、3秒間その場が燃える)
  if (G && G.fireAnim) {
    const t = Date.now() / 1000;
    const fr = G.fireAnim.rect;
    ctx.fillStyle = `rgba(255,60,20,${0.12 + 0.08 * Math.sin(t * 18)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of G.fireAnim.parts) {
      const cycle = (t * 1.3 + p.phase) % 1;
      const y = p.y - cycle * 75;
      const alpha = 1 - cycle;
      if (p.smoke) {
        ctx.fillStyle = `rgba(160,160,160,${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(p.x + Math.sin((t + p.phase) * 5) * 6, y - 34, p.size * (0.8 + cycle), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = cycle < 0.35 ? `rgba(255,220,60,${alpha})` : cycle < 0.7 ? `rgba(255,120,30,${alpha})` : `rgba(200,40,20,${alpha})`;
        ctx.beginPath();
        ctx.arc(p.x + Math.sin((t + p.phase) * 10) * 4, y, p.size * (1 - cycle * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "#ffdddd";
    ctx.font = "bold 20px sans-serif";
    ctx.fillText("!? 煙が…!!", fr.x, Math.max(22, fr.y - 8));
  }

  // プレイヤー
  if (G) {
    const p = G.player;
    ctx.fillStyle = "#f5c542"; // ヘルメット
    ctx.beginPath(); ctx.arc(p.x + 14, p.y + 9, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a6ea5"; // 作業着
    ctx.fillRect(p.x + 5, p.y + 15, 18, 14);
    if (G.inventory.tester) { // テスターを持ってる印
      ctx.fillStyle = "#d8c840";
      ctx.fillRect(p.x + 20, p.y + 18, 7, 10);
    }
  }
}

function collides(nx, ny) {
  const size = 28;
  if (nx < T * 0.5 || ny < T * 0.5 || nx + size > canvas.width - T * 0.5 || ny + size > canvas.height - T * 0.5) return true;
  for (const o of MAP_DEF.objects) {
    const r = objRect(o);
    if (nx + size > r.x + 2 && nx < r.x + r.w - 2 && ny + size > r.y + 2 && ny < r.y + r.h - 2) return true;
  }
  return false;
}

function nearbyObject() {
  if (!G) return null;
  const px = G.player.x + 14, py = G.player.y + 14;
  const margin = 26;
  let best = null, bestDist = Infinity;
  for (const o of MAP_DEF.objects) {
    if (!o.interact) continue;
    const r = objRect(o);
    if (px > r.x - margin && px < r.x + r.w + margin && py > r.y - margin && py < r.y + r.h + margin) {
      // 範囲が重なる帯では、中心が最も近いオブジェクトを選ぶ
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const dist = (px - cx) ** 2 + (py - cy) ** 2;
      if (dist < bestDist) { bestDist = dist; best = o; }
    }
  }
  return best;
}

function startLoop() {
  clearInterval(loopId);
  // setInterval を使う(requestAnimationFrame は裏タブや一部環境で止まるため、
  //  移動やロジックが固まらないよう固定間隔で回す)
  const step = () => {
    // 炎上演出の終了判定(3秒燃えたら結果表示)
    if (G && G.fireAnim && Date.now() > G.fireAnim.until) {
      const p = G.fireAnim.pending;
      G.fireAnim = null;
      showSmokeOverlay(p.text, p.lesson);
    }
    if (G && !G.fireAnim && !anyModalOpen() && !$("#smoke-overlay").classList.contains("active")) {
      const sp = 3;
      let dx = 0, dy = 0;
      if (keys["ArrowUp"] || keys["w"]) dy -= sp;
      if (keys["ArrowDown"] || keys["s"]) dy += sp;
      if (keys["ArrowLeft"] || keys["a"]) dx -= sp;
      if (keys["ArrowRight"] || keys["d"]) dx += sp;
      if (dx && !collides(G.player.x + dx, G.player.y)) G.player.x += dx;
      if (dy && !collides(G.player.x, G.player.y + dy)) G.player.y += dy;
      const near = nearbyObject();
      const hint = $("#interact-hint");
      if (near) {
        hint.style.display = "block";
        hint.textContent = `[スペース] ${near.label} を調べる`;
      } else hint.style.display = "none";
    }
    drawMap();
    if (G) $("#hud-time").textContent = fmtTime((Date.now() - G.startTime) / 1000);
  };
  loopId = setInterval(step, 33); // 約30fps
  step();
}

document.addEventListener("keydown", (e) => {
  keys[e.key] = true;

  // 入力欄・プルダウン操作中はナビ無効(テキスト入力・線番選択を優先)
  const typing = document.activeElement &&
    (document.activeElement.tagName === "INPUT" || document.activeElement.tagName === "SELECT");

  const navKey = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(e.key);

  // 発煙オーバーレイ: Enterで「再開する」
  if ($("#smoke-overlay").classList.contains("active")) {
    if (e.key === "Enter") { $("#smoke-ok").click(); e.preventDefault(); }
    return;
  }

  // 開いているモーダルを矢印/Enterで操作
  if (!typing && navKey) {
    const openOverlay = [...document.querySelectorAll(".overlay.active")].pop();
    if (openOverlay) {
      // テスター等、選択肢が主でないモーダルは menu-list があるものだけ対象
      const listEl = openOverlay.querySelector(".menu-list") || openOverlay.querySelector(".modal");
      if (handleMenuNav(e, listEl)) return;
    } else if ($("#screen-title").classList.contains("active")) {
      if (handleMenuNav(e, $("#screen-title"))) return;
    } else if ($("#screen-select").classList.contains("active")) {
      if (handleStageGridNav(e)) return;
    } else if ($("#screen-brief").classList.contains("active")) {
      if (handleMenuNav(e, $("#brief-box"))) return;
    } else if ($("#screen-result").classList.contains("active")) {
      if (handleMenuNav(e, $("#result-box"))) return;
    }
  }

  if (e.key === " " && G && !G.fireAnim && $("#screen-game").classList.contains("active") && !anyModalOpen() && !$("#smoke-overlay").classList.contains("active")) {
    e.preventDefault();
    const o = nearbyObject();
    if (o) openInteract(o);
  }
  if (e.key === "Escape") {
    document.querySelectorAll(".overlay.active").forEach(o => {
      if (o.id !== "smoke-overlay") o.classList.remove("active");
    });
  }
});
document.addEventListener("keyup", (e) => { keys[e.key] = false; });

// ステージ選択グリッド: 2列を上下左右で移動、Enterで選択
function handleStageGridNav(e) {
  const cards = [...document.querySelectorAll("#stage-grid .stage-card:not(.locked)")];
  const backBtn = $("#select-back");
  const focusables = [...cards, backBtn];
  if (!focusables.length) return false;
  let idx = focusables.indexOf(document.activeElement);
  const cols = 2;
  if (idx < 0) { focusables[0].focus(); e.preventDefault(); return true; }
  if (document.activeElement === backBtn) {
    if (e.key === "Enter") { backBtn.click(); e.preventDefault(); return true; }
    if (e.key === "ArrowUp") { cards[cards.length - 1]?.focus(); e.preventDefault(); return true; }
    return false;
  }
  if (e.key === "Enter") { cards[idx].click(); e.preventDefault(); return true; }
  if (e.key === "ArrowRight") { idx = Math.min(idx + 1, cards.length - 1); }
  else if (e.key === "ArrowLeft") { idx = Math.max(idx - 1, 0); }
  else if (e.key === "ArrowDown") { idx += cols; if (idx >= cards.length) { backBtn.focus(); e.preventDefault(); return true; } }
  else if (e.key === "ArrowUp") { idx -= cols; if (idx < 0) return true; }
  else return false;
  cards[idx].focus(); e.preventDefault(); return true;
}

// ---------------- 汎用メニューモーダル ----------------
// items: [{label, danger?, fn, keep?}] keep=trueならメニューを閉じない
function showMenu(title, desc, items) {
  $("#menu-title").innerHTML = linkTerms(title);
  $("#menu-desc").innerHTML = desc ? linkTerms(desc) : "";
  const list = $("#menu-list");
  list.innerHTML = "";
  for (const it of items) {
    const b = document.createElement("button");
    b.innerHTML = linkTerms(it.label);
    b.onclick = (ev) => {
      // ボタン内の用語(下線)クリックは解説ポップアップだけ。選択肢は実行しない
      if (ev.target.closest(".term")) return;
      if (!it.keep) closeModal("modal-menu");
      it.fn && it.fn();
    };
    list.appendChild(b);
  }
  const close = document.createElement("button");
  close.textContent = "閉じる";
  close.onclick = () => closeModal("modal-menu");
  list.appendChild(close);
  openModal("modal-menu");
  focusFirst(list);
}

// ---- キーボードナビ共通 ----
// コンテナ内の <button>(用語span除く)を上下矢印で移動、Enter/Spaceで決定
function menuButtons(container) {
  return [...container.querySelectorAll("button")].filter(b => b.offsetParent !== null);
}
function focusFirst(container) {
  const btns = menuButtons(container);
  if (btns.length) btns[0].focus();
}
function handleMenuNav(e, container) {
  const btns = menuButtons(container);
  if (!btns.length) return false;
  let idx = btns.indexOf(document.activeElement);
  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    idx = (idx + 1 + btns.length) % btns.length;
    btns[Math.max(0, idx)].focus(); e.preventDefault(); return true;
  }
  if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    idx = (idx <= 0 ? btns.length - 1 : idx - 1);
    btns[idx].focus(); e.preventDefault(); return true;
  }
  if (e.key === "Enter") {
    if (idx >= 0) { btns[idx].click(); e.preventDefault(); return true; }
    btns[0].click(); e.preventDefault(); return true;
  }
  return false;
}

// ---------------- 汎用手順ステージエンジン(Stage3〜10) ----------------
function isGeneric() { return !!(G && GENERIC_STAGES[G.stageId]); }
function gdef() { return G ? GENERIC_STAGES[G.stageId] : null; }

const STATION_INFO = {
  panel:   { title: "制御盤", desc: "制御盤。タッチパネルと操作スイッチが付いている。" },
  pc:      { title: "ノートPC(GX Works2)", desc: "会社のノートPC。GX Works2でPLCとつながっている。" },
  machine: { title: "実習機(装置)", desc: "立ち上げ中の実習機。シリンダ・ロボット・センサーが載っている。" },
  desk:    { title: "作業机", desc: "図面と記録用紙が置いてある。" },
};

function genericModelProcedure(def) {
  return [
    { id: "openZumen", label: "図面・資料を確認する", comment: "作業前にまず図面。" },
    ...def.steps.map(s => ({ id: s.id, label: s.label, comment: s.comment || "手順書どおりに。" })),
    { id: "report", label: "作業完了を申告する(異常があれば記録も報告)", comment: "確認結果を報告して工程完了。" },
  ];
}

function generateGenericDefects(def) {
  const [min, max] = def.defectCountRange;
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const shuffled = [...def.defectPool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count).map(d => ({ ...d, target: d.type, found: false }));
}

function genericStationMenu(station) {
  const def = gdef();
  const items = [];
  for (const s of def.steps.filter(x => x.station === station)) {
    const done = G.doneSteps.has(s.id);
    items.push({ label: (done ? "✔ " : "") + s.label, fn: () => performStep(s) });
  }
  for (const d of (def.dangers || []).filter(x => x.station === station)) {
    items.push({ label: d.label, fn: () => performDanger(d) });
  }
  if (station === "desk") items.push({ label: "図面を確認する", fn: () => openZumen() });
  if (station === "desk" || station === "panel") items.push({ label: "作業完了を申告する", fn: () => openReport() });
  const info = STATION_INFO[station];
  showMenu(info.title, info.desc, items);
}

function performStep(s) {
  if (G.doneSteps.has(s.id)) { toast("それはもう確認済みだ"); return; }
  // 図面・資料を一度も見ずに作業を始めたら軽ミス(Stage1と同じ扱いで統一)
  if (!G.zumenOpened) missLight("genNoZumen", "図面・資料を確認せずに作業を始めた");
  for (const n of (s.needs || [])) {
    if (!G.doneSteps.has(n)) {
      const req = gdef().steps.find(x => x.id === n);
      toast(`先に「${req ? req.label : n}」を済ませる必要がある`, true);
      return;
    }
  }
  for (const n of (s.softNeeds || [])) {
    if (!G.doneSteps.has(n)) {
      const req = gdef().steps.find(x => x.id === n);
      missLight("skip:" + s.id + ":" + n, `「${req.label}」を飛ばして「${s.label}」を行った`);
    }
  }
  const defect = G.defects.find(d => d.type === s.defect && !d.found);
  if (defect) {
    showMenu("様子がおかしい…", defect.eventDesc, [
      { label: defect.correctLabel, fn: () => {
        defect.found = true;
        G.reports.push({ key: defect.type, desc: defect.name, defectIndex: G.defects.indexOf(defect) });
        Sfx.pickup();
        completeStep(s, defect.correctMsg || "異常を記録した。");
      }},
      { label: defect.wrongLabel, fn: () => {
        if (defect.wrongLevel === "big") { missBig(defect.wrongText || defect.name + "を放置した!", defect.lesson, gdef().fireAt); return; }
        if (defect.wrongLevel === "mid") missMid(null, defect.wrongText || "異常への対応を誤った", "");
        completeStep(s, "…先へ進んだ。(何か見落としていないか?)");
      }},
    ]);
    return;
  }
  completeStep(s, s.doneMsg || "確認した。ヨシ!");
}

function completeStep(s, msg) {
  G.doneSteps.add(s.id);
  logAction(s.label, s.id);
  Sfx.click();
  toast(msg);
  if (s.checkpoint) makeCheckpoint(s.label);
  updateChecklist();
}

function performDanger(d) {
  logAction(d.label, null);
  if (d.level === "big") missBig(d.text, d.lesson, d.fireAt || gdef().fireAt);
  else missMid(null, d.text, d.lesson);
}

// ---------------- 配置物ごとのインタラクション ----------------
function openInteract(obj) {
  if (isGeneric()) {
    switch (obj.interact) {
      case "tools": return menuTools();
      case "npc": return openChat();
      case "wallpower": return showMenu("壁の元電源", "投入済みだ。今日の工程では触らない。", []);
      case "desk": case "panel": case "pc": case "machine":
        return genericStationMenu(obj.interact);
    }
    return;
  }
  switch (obj.interact) {
    case "tools": return menuTools();
    case "panel": return menuPanel();
    case "desk": return menuDesk();
    case "npc": return openChat();
    case "wallpower": return menuWallPower();
    case "pc": return showMenu("ノートPC", "GX Works2の入った会社のノートPC。今日の工程では使わない。", []);
    case "machine": return showMenu("実習機(装置)", "立ち上げ中の実習機。今日の工程ではまだ動かさない。", []);
  }
}

function menuTools() {
  const items = [];
  if (!G.inventory.tester) {
    items.push({ label: "テスターを取る", fn: () => { G.inventory.tester = true; Sfx.pickup(); logAction("テスターを取った", "getTools"); toast("テスターを手に入れた"); checkToolsLog(); } });
  } else if (G.testerBroken) {
    items.push({ label: "予備のテスターを取る", fn: () => { G.testerBroken = false; Sfx.pickup(); logAction("予備のテスターを取った", null); toast("予備のテスターを手に入れた。今度は大事に使えよ…"); } });
  }
  if (!G.inventory.pen) {
    items.push({ label: "ペンを取る", fn: () => { G.inventory.pen = true; Sfx.pickup(); logAction("ペンを取った", "getTools"); toast("ペンを手に入れた(確認箇所は図面に自動で記録される)"); checkToolsLog(); } });
  }
  if (!items.length) items.push({ label: "(必要なものは揃っている)", fn: null });
  showMenu("工具置き場", "作業に必要な道具が置いてある。", items);
}
function checkToolsLog() {
  // getTools は両方揃ったら1回だけモデル対応
}

function menuPanel() {
  const s1 = G.stageId === "stage1";
  const items = [];

  items.push({
    label: "主電源ブレーカーのレバー位置を確認する",
    fn: () => {
      G.flags.leverChecked = true;
      logAction("主電源ブレーカーのレバー位置を確認した(OFF位置)", "lever");
      toast(G.flags.mainOn ? "レバーはON位置だ!" : "レバーはOFF位置にある。…だが、見た目だけで信用していいのか?");
      updateChecklist();
    }
  });

  // 危険な操作も常に混ぜる(設計方針)
  if (!G.flags.mainOn) {
    items.push({ label: "主電源をONにする", fn: () => actionMainOn() });
  } else {
    items.push({ label: "主電源をOFFにする", fn: () => {
      G.flags.mainOn = false; Sfx.click();
      logAction("主電源をOFFにした", null);
      toast("主電源をOFFにした");
    }});
  }

  items.push({ label: "CPを操作する", fn: () => menuCP() });
  items.push({ label: "端子台を調べる(テスター測定)", fn: () => {
    if (!G.inventory.tester) { toast("テスターを持っていない。工具置き場で取ってこよう。", true); return; }
    if (G.testerBroken) { toast("テスターが壊れている…。工具置き場で予備を取ってこよう。", true); return; }
    openTester();
  }});

  if (!s1) {
    items.push({ label: "盤内と周囲を確認する(工具・異物・人)", fn: () => {
      G.flags.safetyChecked = true;
      logAction("盤内と周囲の安全を確認した", "safety");
      toast("盤の中に工具の置き忘れなし。周囲に人もいない。ヨシ!");
      updateChecklist();
    }});
    // 機器ランプ確認
    items.push({ label: "機器の電源ランプを確認する", fn: () => checkLamps() });
  }

  items.push({ label: "作業完了を申告する", fn: () => openReport() });

  showMenu("制御盤", s1 ? "真新しい制御盤だ。配線されたばかりで、まだ一度も電気を入れていない。" : "導通チェック済みの制御盤。今日はここに電気を入れる。", items);
}

function actionMainOn() {
  if (G.stageId === "stage1") {
    // 導通チェック工程での主電源ONはご法度
    const liveDefect = G.defects.find(d => d.type === "short" || d.type === "ground");
    if (liveDefect) {
      G.flags.mainOn = true;
      missBig(`短絡・地絡が残ったまま主電源をON!盤から煙が…!`,
        `${liveDefect.name} があるまま通電すると、大電流が流れて配線焼損・機器破損・最悪は火災につながる。導通チェックは「これを防ぐため」にある。`);
      G.flags.mainOn = false;
      return;
    }
    missMid(null, "導通チェックが終わっていないのに主電源を入れた",
      "今回は運良く何もなかったが、確認前の通電は事故のもと。すぐOFFに戻した。");
    logAction("主電源をONにした(手順外)", null);
    return;
  }
  // stage2
  if (!G.flags.sourceOn) {
    toast("スイッチを入れたが何も起きない。…そもそも上流(壁の元電源)から電気が来ていないようだ。");
    logAction("主電源を入れようとしたが一次電源が入っていなかった", null);
    return;
  }
  if (!G.flags.safetyChecked) {
    missLight("mainNoSafety", "周囲・盤内の確認をせずに主電源を投入した");
  }
  G.flags.mainOn = true;
  Sfx.click();
  logAction("主電源をONにした", "mainON");
  toast("バチン。主電源ON。…ランプが点いた。");
  makeCheckpoint("主電源投入完了");
  updateChecklist();
  // 主電源より先にCPが上がっていた場合、投入済みCPの異臭をここで発火(詰み防止)
  for (const cp of CPS) {
    if (G.cps[cp.id]) {
      const smell = G.defects.find(d => d.type === "smell" && d.target === cp.id && !d.found);
      if (smell) { stage2CpEvent(cp.id); break; }
    }
  }
}

function menuCP() {
  const items = [];
  for (const cp of CPS) {
    const on = G.cps[cp.id];
    items.push({
      label: `${cp.label} を${on ? "OFF" : "ON"}にする(現在:${on ? "ON" : "OFF"})`,
      keep: true,
      fn: () => toggleCP(cp.id)
    });
  }
  if (G.stageId === "stage2") {
    items.push({ label: "全CPを一括でONにする", fn: () => cpAllOnAtOnce() });
  }
  items.push({ label: "ONにしたCPの記録を見る", keep: true, fn: () => {
    toast(G.cpLog.length ? "操作記録: " + G.cpLog.join(" → ") : "まだCPを操作していない");
  }});
  showMenu("CP(回路遮断器)", "小さなブレーカーが並んでいる。どれを操作したかは自動で記録される。", items);
  }

function toggleCP(cpId) {
  const turningOn = !G.cps[cpId];

  if (G.stageId === "stage1") {
    if (turningOn && !G.zumenOpened) {
      missLight("cpNoZumen", "図面を確認せずにCPを操作した");
    }
    if (turningOn && !stage1NoVoltDone()) {
      missLight("cpBeforeNoVolt", "無電圧確認が済んでいないのにCPを操作した");
    }
    const cpDef = CPS.find(c => c.id === cpId);
    if (turningOn && !cpDef.neededForCheck) {
      missLight("cpUnneeded", `${cpId}(${CP_DEVICE[cpId]}用)は今日の導通チェックと関係ないのにONにした(図面で必要なCPを確認しよう)`);
    }
  }

  G.cps[cpId] = turningOn;
  if (turningOn) G.cpEverOn[cpId] = true; // 後でOFFに戻してもチェックリストは「済み」のままにする
  Sfx.click();
  G.cpLog.push(`${cpId}${turningOn ? "ON" : "OFF"}`);
  logAction(`${cpId}を${turningOn ? "ON" : "OFF"}にした`, turningOn ? (G.stageId === "stage1" ? "cpon" : "cpEach") : (G.stageId === "stage1" ? "cpoff" : null));
  toast(`カチッ。${cpId}を${turningOn ? "ON" : "OFF"}にした`);

  if (G.stageId === "stage2" && turningOn) {
    const openedEvent = stage2CpEvent(cpId);
    updateChecklist();
    if (!openedEvent) menuCP(); // イベントダイアログを上書きしない
    return;
  }
  updateChecklist();
  menuCP(); // メニューを開き直して表示更新
}

// stage2: CP投入イベント(ランプ確認・異臭)
const CP_DEVICE = { CP1: "PLC", CP2: "DC電源", CP3: "タッチパネル" };
function stage2CpEvent(cpId) {
  if (!G.flags.mainOn) {
    toast(`${cpId}をONにしたが、主電源が入っていないので何も起きない…`);
    return false;
  }
  const smell = G.defects.find(d => d.type === "smell" && d.target === cpId && !d.found);
  if (smell) {
    closeAllModals();
    showMenu(`${cpId}投入直後…`, `ジジ…という小さな音。かすかに焦げ臭い匂いがする!どうする?`, [
      { label: `すぐ${cpId}をOFFにして点検する`, fn: () => {
        G.cps[cpId] = false;
        G.cpLog.push(`${cpId}OFF(異臭で緊急停止)`);
        smell.found = true;
        G.quarantined[cpId] = true;
        G.reports.push({ key: cpId, desc: `${cpId}投入時の異臭(即OFF・点検要)`, defectIndex: G.defects.indexOf(smell) });
        logAction(`${cpId}投入時の異臭に気づき、すぐOFFにして記録した`, "cpEach");
        toast("正解だ。異音・異臭・発煙があったら迷わず切る。記録した。");
        updateChecklist();
      }},
      { label: "気のせいだろう。様子を見る", fn: () => {
        missBig("異臭を無視して通電を続けた。配線から発煙!",
          smell.lesson);
      }}
    ]);
    return true;
  }
  toast(`${cpId}に電源供給。${CP_DEVICE[cpId]}のあたりを確認しよう(「機器の電源ランプを確認する」)`);
  return false;
}

function cpAllOnAtOnce() {
  if (!G.flags.mainOn) { toast("主電源が入っていないので何も起きない…"); return; }
  const anyDefect = G.defects.find(d => !d.found);
  logAction("全CPを一括でONにした", null);
  if (anyDefect) {
    Object.keys(G.cps).forEach(k => G.cps[k] = true);
    missBig("CPを一括投入!どこかから煙が…だがどのCPが原因か分からない!",
      "CPを1つずつ入れるのは「どの回路で異常が起きたか」を特定するため。一括投入は原因の切り分けができず、被害も大きくなる。");
    return;
  }
  Object.keys(G.cps).forEach(k => { G.cps[k] = true; G.cpLog.push(k + "ON"); });
  missMid(null, "CPを一括でONにした", "今回は無事だったが、手順書は「1つずつON」。どのCPで異常が出たか分からなくなるぞ。");
  updateChecklist();
}

function checkLamps() {
  if (!G.flags.mainOn) { toast("主電源が入っていない。ランプはどれも消えている。"); return; }
  const lines = [];
  for (const cp of CPS) {
    const dev = CP_DEVICE[cp.id];
    if (!G.cps[cp.id]) { lines.push(`${dev}:消灯(${cp.id}がOFF)`); continue; }
    const lampDefect = G.defects.find(d => d.type === "lamp" && d.target === dev);
    if (lampDefect && !lampDefect.found) {
      lines.push(`${dev}:点灯しない!(${cp.id}はONなのに…)`);
    } else if (lampDefect && lampDefect.found) {
      lines.push(`${dev}:点灯しない(異常記録済み)`);
    } else {
      lines.push(`${dev}:電源ランプ点灯 ✓`);
      G.lampChecked[cp.id] = true;
    }
  }
  logAction("機器の電源ランプを確認した", "cpEach");
  const unfound = G.defects.find(d => d.type === "lamp" && !d.found && G.cps[Object.keys(CP_DEVICE).find(k => CP_DEVICE[k] === d.target)]);
  showMenu("機器の電源ランプ", lines.join("<br>"), unfound ? [
    { label: `異常として記録する(${unfound.target}のランプ不点灯)`, fn: () => {
      unfound.found = true;
      const cpId = Object.keys(CP_DEVICE).find(k => CP_DEVICE[k] === unfound.target);
      G.lampChecked[cpId] = true;
      G.reports.push({ key: unfound.target, desc: `${unfound.target}の電源ランプ不点灯`, defectIndex: G.defects.indexOf(unfound) });
      logAction(`${unfound.target}のランプ不点灯を異常として記録した`, null);
      toast("記録した。CP・配線・端子台・電源ユニットの点検が必要だ。");
      updateChecklist();
    }}
  ] : []);
  updateChecklist();
}

function menuDesk() {
  showMenu("作業机", "図面と記録用紙が置いてある。", [
    { label: "図面を確認する", fn: () => openZumen() },
    { label: "作業完了を申告する", fn: () => openReport() },
  ]);
}

function menuWallPower() {
  if (G.stageId === "stage1") {
    showMenu("壁の元電源", "工場側の一次電源。今日の作業(導通チェック)では触る必要はないはずだ。", [
      { label: "ONにする", fn: () => {
        missMid("sourceOnS1", "導通チェック工程で一次電源を投入した", "今日は無電圧で行う導通チェックの日だ。すぐOFFに戻した。");
      }},
      { label: "レバー位置を確認する", fn: () => { toast("一次電源はOFF。ヨシ。"); logAction("一次電源のレバー位置を確認した", null); } },
    ]);
    return;
  }
  const items = [];
  if (!G.flags.sourceOn) {
    items.push({ label: "ONにする(一次電源投入)", fn: () => {
      if (!G.flags.safetyChecked) {
        missLight("srcNoSafety", "周囲・盤内の確認をせずに一次電源を投入した");
      }
      G.flags.sourceOn = true;
      Sfx.click();
      logAction("壁の元電源(一次電源)をONにした", "genON");
      toast("ガチャン。一次電源ON。制御盤の一次側まで電気が来た。…異音・異臭なし。");
      updateChecklist();
    }});
  } else {
    items.push({ label: "OFFにする", fn: () => {
      G.flags.sourceOn = false; G.flags.mainOn = false;
      Sfx.click();
      logAction("一次電源をOFFにした", null);
      toast("一次電源をOFFにした(主電源も落ちた)");
    }});
  }
  showMenu("壁の元電源", "工場側の一次電源。ここから盤に電気が供給される。", items);
}

// ---------------- テスター ----------------
const TERMINALS = [];
for (const n of NETS) {
  TERMINALS.push({ id: n.id + ".b", net: n.id, side: "盤側", label: `${n.label} 盤側` });
  TERMINALS.push({ id: n.id + ".k", net: n.id, side: "機器側", label: `${n.label} 機器側` });
}

// Stage1の導通チェック測定シーケンス(同一線番→異線番短絡→対E)
function stage1MeasureSequence() {
  const seq = [];
  for (const n of NETS) seq.push({ a: n.id + ".b", b: n.id + ".k", kind: "same", net: n.id, range: "ohm" });
  for (const p of S1_SHORT_PAIRS) seq.push({ a: p[0] + ".b", b: p[1] + ".b", kind: "short", range: "ohm" });
  for (const p of S1_E_PAIRS) seq.push({ a: p[0] + ".b", b: p[1] + ".b", kind: "e", range: "ohm" });
  return seq;
}
// Stage1の無電圧確認シーケンス(主回路の三相相間・盤側)
function stage1NoVoltSequence() {
  return NOVOLT_PAIRS.map(p => ({ a: p.a + ".b", b: p.b + ".b", kind: "novolt", range: "vac" }));
}
// Stage2の電圧実測シーケンス(系統ごと。三相はどれか1組でOK)
function stage2VoltSequence() {
  const seq = [];
  for (const g of S2_VOLT_GROUPS) {
    const gate = g.id === "AC100V" ? "CP1" : g.id === "DC24V" ? "CP2" : null;
    if (gate && G.quarantined[gate]) continue;       // 異常で使用中止の系統は測らない
    // 全相間が必要な系統(三相)は全ペアを並べる。それ以外は代表の1組
    const pairs = g.all ? g.pairs : [g.pairs[0]];
    for (const pk of pairs) {
      const [n1, n2] = pk.split("-");
      seq.push({
        a: n1 + ".b", b: n2 + ".b", kind: "volt", group: g.id, pairKey: pk, label: g.label,
        range: g.id === "DC24V" ? "vdc" : "vac", gate
      });
    }
  }
  return seq;
}
// 今のステージで「次に測るべき箇所」の並び
function measureSequence() {
  if (!G) return [];
  if (G.stageId === "stage1") {
    return stage1NoVoltDone() ? stage1MeasureSequence() : stage1NoVoltSequence();
  }
  if (G.stageId === "stage2") return stage2VoltSequence();
  return [];
}
function pairMeasured(item) {
  const ta = terminalById(item.a), tb = terminalById(item.b);
  if (item.kind === "same") return G.contDone.has(ta.net);
  if (item.kind === "short") return G.shortDone.has(pairKey(ta.net, tb.net));
  if (item.kind === "e") return G.eDone.has(pairKey(ta.net, tb.net));
  if (item.kind === "novolt") return !!G.noVolt[pairKey(ta.net, tb.net)];
  if (item.kind === "volt") {
    // 全相間が必要な系統はペア単位、それ以外は系統単位で判定
    if (item.pairKey) {
      const g = S2_VOLT_GROUPS.find(x => x.id === item.group);
      return g && g.all ? G.voltDone.has(item.pairKey) : (g ? voltGroupDone(g) : false);
    }
    const g = S2_VOLT_GROUPS.find(x => x.id === item.group);
    return g ? voltGroupDone(g) : false;
  }
  return false;
}
// 次にまだ測っていないペアを返す
function nextUnmeasuredPair() {
  return measureSequence().find(item => !pairMeasured(item)) || null;
}
// CP ONで回り込みの抵抗値を見たが、まだCP OFFでの再確認(Step10)をしていないペア
function pendingMawariPair() {
  if (!G.mawariSeen) return null;
  for (const np of NORMAL_PATHS) {
    const key = pairKey(np.a, np.b);
    if (G.mawariSeen.has(key) && !G.mawariConfirmed.has(key)) {
      return { a: np.a + ".b", b: np.b + ".b", viaCp: np.viaCp };
    }
  }
  return null;
}
function setProbes(aId, bId) {
  $("#probe-a").value = aId;
  $("#probe-b").value = bId;
}
// 測定後に次のペアをプルダウンへ自動セット(案2:自動送り)
function advanceProbes() {
  const next = nextUnmeasuredPair();
  if (next) {
    setProbes(next.a, next.b);
    if (next.range && next.range !== G.range) setRange(next.range); // レンジも合わせる
  }
  updateTesterAuto();
}
// 測定シーケンスの見出し(いま何の工程を測っているか)
function measurePhaseLabel() {
  if (G.stageId === "stage1") return stage1NoVoltDone() ? "導通チェック" : "無電圧確認";
  if (G.stageId === "stage2") return "電圧の実測";
  return "測定";
}
// おまかせボタン等の表示更新
function updateTesterAuto() {
  const area = $("#auto-area");
  const guide = $("#tester-guide");
  if (!area) return;
  const seq = measureSequence();
  if (!seq.length) { area.innerHTML = ""; guide.innerHTML = ""; return; }
  const done = seq.filter(pairMeasured).length;
  const pending = G.stageId === "stage1" ? pendingMawariPair() : null;
  const next = nextUnmeasuredPair();
  if (pending) {
    const cpNowOff = !G.cps[pending.viaCp];
    guide.innerHTML = cpNowOff
      ? `<span class="sub" style="color:#e0c060">「${esc(terminalById(pending.a).label)}」と「${esc(terminalById(pending.b).label)}」を、もう一度当ててみよう。${pending.viaCp}をOFFにしたので抵抗値が消えるはずだ(Step10)。</span>`
      : `<span class="sub" style="color:#e0c060">回り込みの確認が済んでいない。${pending.viaCp}をOFFにしてから、もう一度「${esc(terminalById(pending.a).label)}」と「${esc(terminalById(pending.b).label)}」を当てよう(Step10)。</span>`;
  } else if (next) {
    const rangeName = next.range === "vac" ? "AC電圧(V~)" : next.range === "vdc" ? "DC電圧(V⎓)" : "抵抗(Ω)";
    const extra = next.gate && !G.cps[next.gate] ? ` <span style="color:#e0c060">※${next.gate}がONでないと測れない</span>` : "";
    guide.innerHTML = `<span class="sub">${measurePhaseLabel()} ${done}/${seq.length} — 次に当てる:<b>${esc(terminalById(next.a).label)}</b> と <b>${esc(terminalById(next.b).label)}</b>(レンジ:${rangeName})${extra}</span>`;
  } else {
    guide.innerHTML = `<span class="sub">${measurePhaseLabel()}の測定はすべて完了 ✓</span>`;
  }
  // 無電圧確認後、同一線番を3本以上測って要領を掴んだら「おまかせ」を出す(Stage1の導通チェックのみ)
  const canAuto = G.stageId === "stage1" && stage1NoVoltDone() && G.contDone.size >= 3 && next;
  area.innerHTML = canAuto
    ? `<button id="btn-auto" class="small">残りを同じ要領で確認する(おまかせ)</button>
       <span class="hint-small">※異常が出たら手が止まる。判断と記録は自分でやる。</span>`
    : "";
  if (canAuto) $("#btn-auto").onclick = () => autoMeasureRemaining();
  renderAutoResults(G.autoLog || []);
}
// おまかせ測定(案3:異常が出たら停止してプレイヤーに委ねる)
function autoMeasureRemaining() {
  const out = $("#tester-result"), an = $("#anomaly-area");
  const log = G.autoLog || (G.autoLog = []);
  let guard = 0;
  while (guard++ < 60) {
    const item = nextUnmeasuredPair();
    if (!item) break;
    const ta = terminalById(item.a), tb = terminalById(item.b);
    G.pendingAnomaly = null; G.pendingBlocked = null;
    const r = measureOhm(ta, tb, out, an);
    const label = `${ta.label} - ${tb.label}`;

    // CP未投入で測れない → 停止(完了扱いにしない)
    if (G.pendingBlocked) {
      setProbes(item.a, item.b);
      log.push({ label, text: r.text, status: "blocked", note: `${G.pendingBlocked}がOFF` });
      renderAutoResults(log);
      toast(`${G.pendingBlocked}がOFFのままだ。CPを入れてから続けろ。おまかせを中断した。`, true);
      updateTesterAuto();
      return;
    }
    // 不良 or 回り込み → 停止して手を止める
    if (G.pendingAnomaly) {
      setProbes(item.a, item.b);
      log.push({ label, text: r.text, status: "check", note: r.anomaly ? r.anomaly.desc : "" });
      renderAutoResults(log);
      toast("おまかせ中に気になる測定結果が出た。自分の目で確認してくれ。", true);
      updateTesterAuto();
      return;
    }
    log.push({ label, text: r.text, status: "ok" });
  }
  renderAutoResults(log);
  if (!nextUnmeasuredPair()) toast("導通チェックの測定をすべて完了した。");
  advanceProbes();
  updateTesterAuto();
}

// おまかせで測った結果の一覧を表示
function renderAutoResults(log) {
  const area = $("#auto-results");
  if (!area) return;
  if (!log.length) { area.innerHTML = ""; return; }
  const icon = { ok: "✔", check: "⚠", blocked: "⛔" };
  const color = { ok: "#7bd88f", check: "#e0c060", blocked: "#e08a4a" };
  const rows = log.map(r =>
    `<div class="auto-row"><span style="color:${color[r.status]}">${icon[r.status]}</span>
     <span class="ar-label">${esc(r.label)}</span>
     <span class="ar-text">${esc(r.text)}${r.note ? ` <em>${esc(r.note)}</em>` : ""}</span></div>`
  ).join("");
  area.innerHTML = `<div class="auto-results-box"><div class="ar-head">おまかせ測定の結果(${log.length}件)</div>${rows}</div>`;
}

function openTester() {
  const selA = $("#probe-a"), selB = $("#probe-b");
  if (!selA.options.length) {
    for (const t of TERMINALS) {
      selA.add(new Option(t.label, t.id));
      selB.add(new Option(t.label, t.id));
    }
    selB.selectedIndex = 1;
  }
  setRange(G.range || "ohm");
  $("#tester-result").innerHTML = `<span class="sub">レンジを選び、2点を選んで[測定]</span>`;
  $("#anomaly-area").innerHTML = "";
  // 次に当てるペアを最初からセットしておく(全ステージ共通)
  // (CPを切りに行って戻ってきた場合、確認待ちの回り込みペアを優先して呼び戻す)
  const pending = G.stageId === "stage1" ? pendingMawariPair() : null;
  const next = pending || nextUnmeasuredPair();
  if (next) {
    setProbes(next.a, next.b);
    if (!pending && next.range) setRange(next.range);
  }
  updateTesterAuto();
  openModal("modal-tester");
}
function setRange(r) {
  G.range = r;
  document.querySelectorAll(".range-row button").forEach(b => b.classList.toggle("sel", b.dataset.range === r));
}
document.querySelectorAll(".range-row button").forEach(b => b.onclick = () => setRange(b.dataset.range));

$("#btn-measure").onclick = () => doMeasure();

function terminalById(id) { return TERMINALS.find(t => t.id === id); }

function doMeasure() {
  const a = terminalById($("#probe-a").value);
  const b = terminalById($("#probe-b").value);
  const out = $("#tester-result");
  const anomalyArea = $("#anomaly-area");
  anomalyArea.innerHTML = "";
  G.pendingAnomaly = null;

  if (a.id === b.id) { out.innerHTML = `--- <span class="sub">同じ端子に2本当てても意味がないぞ</span>`; return; }

  const powered = G.flags.mainOn; // 通電中か
  const range = G.range;

  // --- 危険系: 通電中にΩ/Aレンジ ---
  if (powered && (range === "ohm" || range === "amp")) {
    G.testerBroken = true;
    missMid(null, range === "ohm" ? "通電中の回路をΩレンジで測定し、テスターを壊した" : "電圧のかかった2点間にAレンジで当ててヒューズを飛ばした",
      "工具置き場で予備のテスターを取ってこよう。レンジと通電状態は測る前に必ず確認。");
    closeModal("modal-tester");
    return;
  }

  if (range === "amp") {
    out.innerHTML = `0.00A <span class="sub">Aレンジは回路に直列に入れて使うもの。今この2点に当てても意味がない。</span>`;
    logAction(`${a.label}-${b.label}をAレンジで測定(意味なし)`, null);
    return;
  }

  if (range === "ohm") {
    measureOhm(a, b, out, anomalyArea);
    // 手動測定後、異常/CP未投入がなければ次のペアを自動セット(案2:自動送り)
    if (!G.pendingAnomaly && !G.pendingBlocked) advanceProbes();
    else updateTesterAuto();
    return;
  }
  measureVolt(a, b, range, out, anomalyArea);
  // 電圧測定も、うまく測れたら次の箇所へ自動送り
  if (!G.pendingAnomaly) advanceProbes();
  else updateTesterAuto();
}

// Ωレンジの結果を決める
function resolveOhm(a, b) {
  // 戻り値: {beep, text, anomaly: null | {desc, defect(見つけた不良 or null), kind}}
  const d = G.defects;
  const find = (fn) => d.find(fn);

  const swap = find(x => x.type === "swap");
  const isSwapNet = (net) => swap && swap.target.includes(net);

  if (a.net === b.net) {
    // 同一線番(盤側-機器側)
    const net = NETS.find(n => n.id === a.net);
    const brk = find(x => x.type === "break" && x.target === net.id);
    const loose = find(x => x.type === "loose" && x.target === net.id);
    if (isSwapNet(net.id)) {
      return { beep: false, text: "0L(導通なし)", anomaly: { desc: `同一線番 ${net.id} で導通しない`, defect: swap, kind: "same-ol" } };
    }
    if (net.cpGate && !G.cps[net.cpGate]) {
      // CPがOFFで導通しないのは配線不良ではなく自分の手順ミス。記録も完了もさせない
      return { beep: false, text: `0L(導通なし)`, note: `この回路は${net.cpGate}を経由している。CPがOFFなら導通しないのは当然だ。CPを入れてから測り直せ。`, blocked: net.cpGate };
    }
    if (brk) {
      return { beep: false, text: "0L(導通なし)", anomaly: { desc: `同一線番 ${net.id} で導通しない`, defect: brk, kind: "same-ol" } };
    }
    if (loose) {
      const flicker = Math.random() < 0.5;
      return { beep: flicker, text: flicker ? "0.4Ω…12Ω…0L…?(表示が安定しない)" : "0L…0.6Ω…?(表示が安定しない)", anomaly: { desc: `同一線番 ${net.id} の導通が不安定(付いたり切れたり)`, defect: loose, kind: "unstable" } };
    }
    return { beep: true, text: "0.2Ω ピー(導通あり)", anomaly: null };
  }

  // 異線番間
  const netA = a.net, netB = b.net;
  const key = pairKey(netA, netB);

  // 回り込み確認(Step10): CP ONで抵抗値を見たペアを、CP OFFで再測定して消えるか確かめる行為は
  // 「CPを入れ直せ」のブロック対象にしない(これは正しい手順そのもの)
  const npForConfirm = NORMAL_PATHS.find(p => pairKey(p.a, p.b) === key);
  if (npForConfirm && G.mawariSeen.has(key) && !G.cps[npForConfirm.viaCp]) {
    if (!G.mawariConfirmed.has(key)) {
      G.mawariConfirmed.add(key);
      logAction(`${key} 間、CPをOFFにして回り込みの抵抗値が消えることを確認`, "mawari");
    }
    return { beep: false, text: "0L(導通なし)", note: "CPをOFFにしたら消えた。やはり回り込みだった。短絡ではない。" };
  }

  // どちらかの線番がCP経由で、そのCPがOFFなら測れない(短絡・対E確認もCP投入が前提)
  const netAObj = NETS.find(n => n.id === netA);
  const netBObj = NETS.find(n => n.id === netB);
  const gateOff = (netAObj && netAObj.cpGate && !G.cps[netAObj.cpGate]) ? netAObj.cpGate
    : (netBObj && netBObj.cpGate && !G.cps[netBObj.cpGate]) ? netBObj.cpGate : null;
  if (gateOff) {
    return { beep: false, text: `0L(導通なし)`, note: `${netA}か${netB}は${gateOff}を経由している。CPがOFFのままでは正しく確認できない。CPを入れてから測り直せ。`, blocked: gateOff };
  }

  // 入れ違い(盤側X001↔機器側X002)
  if (swap && swap.target.includes(netA) && swap.target.includes(netB)) {
    const cross = (a.side !== b.side);
    if (cross) {
      return { beep: true, text: "0.3Ω ピー(導通あり!?)", anomaly: { desc: `異線番 ${netA}-${netB} 間(${a.side}-${b.side})で導通した`, defect: swap, kind: "cross-beep" } };
    }
    return { beep: false, text: "0L(導通なし)", anomaly: null };
  }

  // 短絡
  const short = G.defects.find(x => x.type === "short" && pairKey(x.target[0], x.target[1]) === key);
  if (short) {
    return { beep: true, text: "0.1Ω ピー(導通あり!?)", anomaly: { desc: `異線番 ${netA}-${netB} 間で導通した(短絡の疑い)`, defect: short, kind: "short-beep" } };
  }

  // 地絡(電源線-E)
  const ground = G.defects.find(x => x.type === "ground" && ((x.target === netA && netB === "E") || (x.target === netB && netA === "E")));
  if (ground) {
    return { beep: true, text: "0.2Ω ピー(導通あり!?)", anomaly: { desc: `${ground.target}-E間で導通した(地絡の疑い)`, defect: ground, kind: "ground-beep" } };
  }

  // 回り込み(正常だが抵抗値が見える)
  const np = NORMAL_PATHS.find(p => pairKey(p.a, p.b) === key);
  if (np && G.cps[np.viaCp]) {
    G.mawariSeen.add(key); // CP OFFでの再確認(Step10)を許可するフラグ
    return { beep: false, text: `${(np.ohms / 1000).toFixed(1)}kΩ(値が見える…)`, note: "図面と抵抗値を照合して判断しよう。CPをOFFにして消えるなら回り込みだ。", anomaly: { desc: `異線番 ${np.a}-${np.b} 間に${(np.ohms / 1000).toFixed(1)}kΩの抵抗値`, defect: null, kind: "mawarikomi" } };
  }

  return { beep: false, text: "0L(導通なし)", anomaly: null };
}

function measureOhm(a, b, out, anomalyArea) {
  // 手順逸脱チェック(stage1のみ、無電圧確認前)
  if (G.stageId === "stage1" && !stage1NoVoltDone()) {
    missMid("ohmBeforeNoVolt", "無電圧確認をせずに導通チェックを始めた",
      "今回は無電圧だったから助かったが、通電中にΩレンジを当てたらテスターが壊れる。順番を守れ。");
  }

  const r = resolveOhm(a, b);
  if (r.beep) Sfx.beep();
  out.innerHTML = `${esc(r.text)}${r.note ? `<span class="sub">${esc(r.note)}</span>` : ""}`;
  logAction(`Ωレンジ測定: ${a.label} - ${b.label} → ${r.text}`, null);
  G.pendingBlocked = null;

  // CP未投入で測れない: 完了扱いにしない・記録もさせない
  if (r.blocked) {
    G.pendingBlocked = r.blocked;
    G.pendingAnomaly = null;
    anomalyArea.innerHTML = `<div class="anomaly-box" style="border-color:#c8a24a">
      ${esc(r.note)}</div>`;
    updateChecklist();
    return r;
  }

  // 進捗登録
  const key = pairKey(a.net, b.net);
  if (a.net === b.net && a.side !== b.side) {
    // 同一線番チェック
    if (!r.anomaly) {
      if (!G.contDone.has(a.net)) {
        G.contDone.add(a.net);
        G.markers.add("cont:" + a.net);
        logAction(`同一線番 ${a.net} の導通OKを確認、図面にマーカー`, "cont");
        toast(`図面の ${a.net} にマーカーを付けた ✓`);
      }
    }
  } else if (a.net !== b.net) {
    const isEPair = (a.net === "E" || b.net === "E");
    if (isEPair) {
      if (!G.eDone.has(key)) { G.eDone.add(key); G.markers.add("e:" + key); logAction(`${key} 間の対E確認を実施`, "short"); }
    } else {
      if (!G.shortDone.has(key)) { G.shortDone.add(key); G.markers.add("short:" + key); logAction(`${key} 間の短絡確認を実施`, "short"); }
    }
  }

  // 異常の記録UI
  if (r.anomaly) {
    G.pendingAnomaly = { ...r.anomaly, measureDesc: `${a.label} - ${b.label} : ${r.text}`, contNet: (a.net === b.net ? a.net : null) };
    anomalyArea.innerHTML = `
      <div class="anomaly-box">
        図面どおりの結果と違うようだ…。<br>${esc(r.anomaly.desc)}
        <div class="footer">
          <button id="btn-record-anomaly" class="primary small">異常として記録する</button>
        </div>
      </div>`;
    $("#btn-record-anomaly").onclick = () => recordAnomaly();
  }
  updateChecklist();
  return r;
}

function recordAnomaly() {
  const p = G.pendingAnomaly;
  if (!p) return;
  const already = G.reports.find(rep => rep.desc === p.desc);
  if (already) { toast("その異常はもう記録済みだ"); return; }
  const defectIndex = p.defect ? G.defects.indexOf(p.defect) : null;
  if (p.defect) p.defect.found = true;
  G.reports.push({ key: p.desc, desc: p.desc, defectIndex, kind: p.kind });
  logAction(`異常を記録: ${p.desc}`, null);
  Sfx.pickup();
  toast(`異常を記録した:「${p.desc}」`);
  // 同一線番の異常を記録したら、そのチェック自体は「実施済み」にする
  if (p.contNet) {
    G.contDone.add(p.contNet);
    G.markers.add("cont:" + p.contNet + ":NG");
  }
  $("#anomaly-area").innerHTML = "";
  G.pendingAnomaly = null;
  updateChecklist();
  advanceProbes();
}

// Vレンジ
// 無電圧確認は主回路(AC200V)の三相相間で行う。
// R-S-T が無電圧なら上流(主電源)が切れている証拠で、下流の制御回路にも電圧は来ない。
const NOVOLT_PAIRS = [
  { a: "R", b: "S", ac: true }, { a: "S", b: "T", ac: true }, { a: "R", b: "T", ac: true }
];
// 通電中に測れる電圧(三相なのでR-S/S-T/R-Tはいずれも200V級)
const VOLT_EXPECT = {
  "R-S": { v: "202V", ac: true }, "S-T": { v: "201V", ac: true }, "R-T": { v: "203V", ac: true },
  "L-N": { v: "101V", ac: true }, "0V-P": { v: "24.1V", ac: false }
};
// Stage2で「電圧確認済み」として要求する系統
// 三相は1相でも欠相していれば事故につながるため、R-S・S-T・R-Tの全相間を測る
const S2_VOLT_GROUPS = [
  { id: "AC200V", pairs: ["R-S", "S-T", "R-T"], label: "主回路AC200V(全相間)", all: true },
  { id: "AC100V", pairs: ["L-N"], label: "制御AC100V(L-N)" },
  { id: "DC24V", pairs: ["0V-P"], label: "制御DC24V(P-0V)" },
];
// その系統の電圧確認が完了したか(all:trueなら全ペア必要)
function voltGroupDone(g) {
  return g.all ? g.pairs.every(k => G.voltDone.has(k)) : g.pairs.some(k => G.voltDone.has(k));
}

function measureVolt(a, b, range, out) {
  const isAC = range === "vac";
  const key = pairKey(a.net, b.net);
  const np = NOVOLT_PAIRS.find(p => pairKey(p.a, p.b) === key);

  // 主電源OFF・一次電源ONのとき、主回路の盤側(=主電源の1次側)には電圧が来ている
  const bothPanel = (a.side === "盤側" && b.side === "盤側");
  const isMainCircuit = !!np; // R-S / S-T / R-T
  if (!G.flags.mainOn && G.flags.sourceOn && isMainCircuit && bothPanel) {
    const exp1 = VOLT_EXPECT[key];
    if (isAC) {
      Sfx.click();
      out.innerHTML = `${exp1.v} <span class="sub">AC — ここは主電源の<b>1次側</b>。元電源が入っているので電圧が来ている。<br>この先(2次側・制御回路)に電気を送るには主電源をONにする。</span>`;
      logAction(`Vレンジ測定: ${key}(主電源1次側) → ${exp1.v}`, null);
      if (G.stageId === "stage2" && !G.voltDone.has(key)) {
        G.voltDone.add(key);
        G.markers.add("volt:" + key);
        logAction(`${key} 間の電圧を実測: ${exp1.v}(1次側・正常)`, "volt");
        toast(`${key} 間 ${exp1.v}。図面にマーカーを付けた ✓`);
      }
    } else {
      missMid("voltWrongRange", "AC回路をDCレンジで測定した", "AC200Vの相間をDCレンジで測ってもまともな値は出ない。回路がACかDCか、図面で確認してからレンジを合わせよう。");
      out.innerHTML = `0.00V <span class="sub">(あれ?)なんだこの値は…</span>`;
    }
    updateChecklist();
    return;
  }

  if (!G.flags.mainOn) {
    // 無電圧
    out.innerHTML = `0.00V <span class="sub">${isAC ? "AC" : "DC"}レンジ</span>`;
    logAction(`${isAC ? "AC" : "DC"}Vレンジ測定: ${a.label} - ${b.label} → 0.00V`, null);
    if (G.stageId === "stage1" && np) {
      const bothPanelSide = (a.side === "盤側" && b.side === "盤側");
      if (!bothPanelSide) {
        // 機器側(2次側)は電源が来ないので0Vは当たり前。無電圧確認にならない
        out.innerHTML = `0.00V <span class="sub">ここは機器側(2次側)。電源が来ていないので0Vは当然だ。無電圧確認は<b>盤側(1次側・主電源の入口)</b>で測らないと意味がないぞ。</span>`;
        missLight("novoltWrongSide", `${key} 間を機器側で測っても無電圧確認にならない。盤側(1次側)で測ろう`);
        updateChecklist();
        return;
      }
      if (np.ac === isAC) {
        if (!G.noVolt[key]) {
          G.noVolt[key] = true;
          G.markers.add("novolt:" + key);
          logAction(`${key} 間(盤側)の無電圧を実測で確認`, "novolt");
          toast(`${key} 間(盤側)0V。無電圧を確認 ✓`);
          if (stage1NoVoltDone()) {
            toast("盤内の無電圧確認が完了!ここからが導通チェック本番だ。");
            makeCheckpoint("無電圧確認完了");
          }
        }
      } else {
        missLight("novoltWrongRange", `${key} 間は${np.ac ? "AC" : "DC"}回路。レンジ(AC/DC)を確認してから測定しよう`);
      }
    }
    updateChecklist();
    return;
  }

  // 通電中(stage2)
  const exp = VOLT_EXPECT[key];
  if (!exp) {
    out.innerHTML = `0.00V <span class="sub">この2点間に電圧はないようだ</span>`;
    logAction(`Vレンジ測定: ${a.label} - ${b.label} → 0V`, null);
    return;
  }
  // 系統のCPが必要(制御回路)
  const netDef = NETS.find(n => n.id === a.net) || {};
  const gate = (key === "L-N") ? "CP1" : (key === "0V-P") ? "CP2" : null;
  if (gate && !G.cps[gate]) {
    out.innerHTML = `0.00V <span class="sub">(${gate}がOFFなので電圧が来ていない)</span>`;
    logAction(`Vレンジ測定: ${key} → 0V(${gate} OFF)`, null);
    return;
  }
  if (exp.ac !== isAC) {
    missMid("voltWrongRange", "AC/DCレンジを間違えて測定した", "表示された値で判断を誤るところだった。回路がACかDCか、図面で確認してからレンジを合わせよう。");
    out.innerHTML = `${exp.ac ? "3.8V(ふらふら動く…?)" : "0.00V(あれ?)"} <span class="sub">なんだこの値は…</span>`;
    logAction(`Vレンジ測定(レンジ違い): ${key}`, null);
    return;
  }
  Sfx.click();
  out.innerHTML = `${exp.v} <span class="sub">${isAC ? "AC" : "DC"} 正常値だ</span>`;
  if (!G.voltDone.has(key)) {
    G.voltDone.add(key);
    G.markers.add("volt:" + key);
    logAction(`${key} 間の電圧を実測: ${exp.v}(正常)`, "volt");
    toast(`${key} 間 ${exp.v}。図面にマーカーを付けた ✓`);
  }
  updateChecklist();
}

// ---------------- 進捗判定 ----------------
function stage1NoVoltDone() {
  return NOVOLT_PAIRS.every(p => G.noVolt[pairKey(p.a, p.b)]);
}
const S1_SHORT_PAIRS = [["R", "S"], ["R", "T"], ["S", "T"], ["L", "N"], ["P", "0V"]];
const S1_E_PAIRS = ["R", "S", "T", "L", "N", "P", "0V"].map(n => [n, "E"]);
const S1_CONT_NETS = NETS.map(n => n.id);

function stage1ContDone() { return S1_CONT_NETS.every(n => G.contDone.has(n)); }
function stage1ShortDone() {
  return S1_SHORT_PAIRS.every(p => G.shortDone.has(pairKey(p[0], p[1]))) &&
         S1_E_PAIRS.every(p => G.eDone.has(pairKey(p[0], p[1])));
}
function cpAllOff() { return !G.cps.CP1 && !G.cps.CP2 && !G.cps.CP3; }

function stage2Requirements() {
  const cpsHandled = CPS.every(cp => {
    if (G.quarantined[cp.id]) return true;             // 異常発見済み→対処済扱い
    return G.cps[cp.id] && G.lampChecked[cp.id];       // ON+ランプ確認
  });
  // 系統ごとに1組でも測れていればOK(三相はR-S/S-T/R-Tのどれか)
  const requiredGroups = S2_VOLT_GROUPS.filter(g => {
    const gate = g.id === "AC100V" ? "CP1" : g.id === "DC24V" ? "CP2" : null;
    return !(gate && G.quarantined[gate]);
  });
  const voltOk = requiredGroups.every(voltGroupDone);
  const voltDoneCount = requiredGroups.filter(voltGroupDone).length;
  return { cpsHandled, voltOk, voltDoneCount, voltTotal: requiredGroups.length, requiredGroups };
}

function updateChecklist() {
  const el = $("#check-list");
  if (!G) return;
  let items;
  if (isGeneric()) {
    items = gdef().steps.map(s => [G.doneSteps.has(s.id), s.label]);
  } else if (G.stageId === "stage1") {
    const contCount = S1_CONT_NETS.filter(n => G.contDone.has(n)).length;
    const shortCount = S1_SHORT_PAIRS.filter(p => G.shortDone.has(pairKey(p[0], p[1]))).length;
    const eCount = S1_E_PAIRS.filter(p => G.eDone.has(pairKey(p[0], p[1]))).length;
    items = [
      [G.inventory.tester && G.inventory.pen, "道具の準備(テスター・ペン)"],
      [G.flags.leverChecked, "主電源ブレーカーのOFF確認(Step1)"],
      [stage1NoVoltDone(), `盤内無電圧確認(Step2) ${NOVOLT_PAIRS.filter(p => G.noVolt[pairKey(p.a, p.b)]).length}/3`],
      [G.cpEverOn.CP1 && G.cpEverOn.CP2, "導通確認用CPのON(Step3: CP1・CP2)"],
      [stage1ContDone(), `同一線番の導通確認(Step4〜7) ${contCount}/${S1_CONT_NETS.length}`],
      [shortCount === S1_SHORT_PAIRS.length, `異線番の短絡確認(Step8) ${shortCount}/${S1_SHORT_PAIRS.length}`],
      [eCount === S1_E_PAIRS.length, `電源線とE間の確認(Step9) ${eCount}/${S1_E_PAIRS.length}`],
      [cpAllOff() && G.cpLog.length > 0, "CPを全てOFFに戻す(Step11)"],
    ];
    if (stage1ContDone() && stage1ShortDone() && !G.missOnce["cpContDone"]) {
      G.missOnce["cpContDone"] = true;
      makeCheckpoint("導通チェック完了");
    }
  } else {
    const req = stage2Requirements();
    items = [
      [G.inventory.tester && G.inventory.pen, "道具の準備(テスター・ペン)"],
      [G.flags.safetyChecked, "盤内・周囲の安全確認"],
      [G.flags.sourceOn, "一次電源(壁の元電源)ON(Step12)"],
      [G.flags.mainOn, "主電源ON(Step13)"],
      [req.cpsHandled, "CP個別ON+機器確認(Step14〜15)"],
      [req.voltOk, `各系統の電圧実測 ${req.voltDoneCount}/${req.voltTotal}`],
    ];
  }
  el.innerHTML = items.map(([done, label]) =>
    `<div class="${done ? "done" : "todo"}">${done ? "✔" : "□"} ${esc(label)}</div>`).join("") +
    (G.reports.length ? `<div style="margin-top:8px;color:var(--red)">記録した異常: ${G.reports.length}件</div>` : "");
}

// ---------------- 図面 ----------------
function openZumen() {
  G.zumenOpened = true;
  if (!G.actionLog.some(l => l.modelId === "openZumen")) logAction("図面を確認した", "openZumen");
  const isS2 = G.stageId === "stage2";
  // ヘッダーをステージに合わせる
  const head = $("#zumen-head");
  if (head) {
    head.innerHTML = isS2
      ? `<tr><th>線番</th><th>系統</th><th>経路</th><th>電圧確認</th></tr>`
      : `<tr><th>線番</th><th>系統</th><th>経路</th><th>導通</th><th>対E</th></tr>`;
  }
  // CPの役割はステージによって「関係あるか」が変わる(CP3=タッチパネル用は今日の導通チェックとは無関係)
  const cpNote = $("#zumen-cp-note");
  if (cpNote) {
    cpNote.innerHTML = isS2
      ? `・CP: <b>CP1(AC100V制御・PLC)・CP2(DC24V制御・DC電源)・CP3(タッチパネル用)</b> — 3つとも1つずつONにして機器を確認する`
      : `・導通確認用CP: <b>CP1(AC100V制御)・CP2(DC24V制御)</b>(CP3はタッチパネル用の回路。今日の導通チェックには関係ない)`;
  }
  const tbl = $("#zumen-body");
  tbl.innerHTML = "";
  for (const n of NETS) {
    const tr = document.createElement("tr");
    const route = `盤側端子台 ${n.cpGate ? `→ <b>[${n.cpGate}]</b> ` : "→ "}→ 機器側端子台`;
    if (isS2) {
      // その線番が属する系統の電圧が測れているか(三相は関係する相間ごとに表示)
      const grp = S2_VOLT_GROUPS.find(g => g.pairs.some(k => k.split("-").includes(n.id)));
      let cell = "(測定対象外)", vDone = false;
      const grpGate = grp ? (grp.id === "AC100V" ? "CP1" : grp.id === "DC24V" ? "CP2" : null) : null;
      if (grp && grpGate && G.quarantined[grpGate]) {
        cell = `<span style="color:#e0a860">${grpGate}点検中のため対象外</span>`;
      } else if (grp) {
        const myPairs = grp.pairs.filter(k => k.split("-").includes(n.id));
        const doneP = myPairs.filter(k => G.voltDone.has(k));
        vDone = doneP.length === myPairs.length;
        cell = doneP.length
          ? `${vDone ? "✔" : ""}${esc(doneP.join("・"))} 実測済${vDone ? "" : ` <span style="color:#e0c060">(残:${esc(myPairs.filter(k => !G.voltDone.has(k)).join("・"))})</span>`}`
          : "-";
      }
      tr.innerHTML = `
        <td>${esc(n.id)}</td><td>${esc(n.group)}</td><td>${route}</td>
        <td class="${vDone ? "ok" : ""}">${cell}</td>`;
    } else {
      const marked = G.markers.has("cont:" + n.id);
      const ng = G.markers.has("cont:" + n.id + ":NG");
      const eKey = pairKey(n.id, "E");
      const eDone = n.id !== "E" && G.eDone.has(eKey);
      tr.innerHTML = `
        <td>${esc(n.id)}</td><td>${esc(n.group)}</td><td>${route}</td>
        <td class="${marked && !ng ? "ok" : ""}">${ng ? "⚠異常記録" : marked ? "✔確認済" : "-"}</td>
        <td class="${eDone ? "ok" : ""}">${n.id === "E" ? "—" : eDone ? "✔確認済" : "-"}</td>`;
    }
    tbl.appendChild(tr);
  }
  // 線番の組み合わせで見る確認(短絡・無電圧)は表の下にまとめる
  const lines = [];
  if (!isS2) {
    const shortList = S1_SHORT_PAIRS.map(p => {
      const k = pairKey(p[0], p[1]);
      return `${k}${G.shortDone.has(k) ? "✔" : "□"}`;
    });
    lines.push(`<b>異線番の短絡確認(Step8):</b> ${shortList.join(" / ")}`);
    const nvList = NOVOLT_PAIRS.map(p => {
      const k = pairKey(p.a, p.b);
      return `${k}${G.noVolt[k] ? "✔" : "□"}`;
    });
    lines.push(`<b>無電圧確認(Step2・盤側):</b> ${nvList.join(" / ")}`);
  } else {
    const vList = S2_VOLT_GROUPS.map(g => {
      const gate = g.id === "AC100V" ? "CP1" : g.id === "DC24V" ? "CP2" : null;
      if (gate && G.quarantined[gate]) {
        // 異常発見でそのCPを点検中にした系統は、通電できないので測定対象から外れる
        return `${g.label}: <span style="color:#e0a860">${gate}は異常のため点検中 — この系統の電圧確認は対象外</span>`;
      }
      const detail = g.pairs.map(k => `${k}${G.voltDone.has(k) ? "✔" : "□"}`).join(" ");
      const note = gate && !G.cps[gate] ? ` <span style="color:#e0c060">(${gate}がOFF)</span>` : "";
      return `${g.label}: ${detail}${note}`;
    });
    lines.push(`<b>電圧の実測(Step15):</b><br>　${vList.join("<br>　")}`);
  }
  $("#zumen-marks").innerHTML = lines.join("<br>") +
    `<br><span style="color:var(--dim)">※テスターで正しく測定すると自動でチェックが付く(現場でペンでなぞるのと同じ)</span>`;
  openModal("modal-zumen");
}
$("#btn-zumen").onclick = () => { if (G) openZumen(); };
$("#btn-checklist").onclick = () => { if (G) { updateChecklist(); openModal("modal-checklist"); } };
$("#btn-settings").onclick = () => openSettings();
$("#btn-quit").onclick = () => {
  if (confirm("ステージを中断してステージ選択に戻りますか?(進行中の記録は消えます)")) {
    G = null;
    renderStageSelect();
    show("screen-select");
  }
};

// ---------------- 申告(完了報告) ----------------
function openReport() {
  const problems = [];
  if (isGeneric()) {
    for (const s of gdef().steps) if (!G.doneSteps.has(s.id)) problems.push(`未実施: ${s.label}`);
  } else if (G.stageId === "stage1") {
    if (!G.flags.leverChecked) problems.push("主電源ブレーカーのレバー確認がまだ");
    if (!stage1NoVoltDone()) problems.push("無電圧確認がまだ終わっていない");
    if (!stage1ContDone()) problems.push("同一線番の導通確認が残っている");
    if (!stage1ShortDone()) problems.push("短絡・対E確認が残っている");
    if (!cpAllOff()) problems.push("CPがONのままになっている");
  } else {
    const req = stage2Requirements();
    if (!G.flags.sourceOn) problems.push("一次電源が入っていない");
    if (!G.flags.mainOn) problems.push("主電源が入っていない");
    if (!req.cpsHandled) problems.push("CPの個別投入・機器確認が終わっていない");
    if (!req.voltOk) problems.push("電圧の実測が終わっていない");
  }
  const falseReports = G.reports.filter(r => r.defectIndex === null);

  let desc = "";
  if (problems.length) {
    desc += `<b style="color:var(--red)">まだ終わっていない項目がある:</b><br>・${problems.map(esc).join("<br>・")}<br><br>`;
  }
  desc += `記録した異常: ${G.reports.length ? G.reports.map(r => esc(r.desc)).join(" / ") : "なし(異常なしとして申告)"}`;
  if (falseReports.length) {
    desc += `<br><br><span style="color:var(--accent)">…記録の中に、本当に「異常」か怪しいものはないか?回り込みやCPの状態は確認したか?</span>`;
  }

  showMenu("作業完了の申告", desc, [
    { label: problems.length ? "このまま申告する(強行)" : "申告する", fn: () => submitReport(problems) },
    { label: "やっぱり現場に戻る", fn: () => {} },
  ]);
}

// 異常でCPを点検中にした系統は通電できないので、その配下の不良は確認しようがない
// (正しい対処をしたプレイヤーが「見逃し」で不合格になるのを防ぐ)
function defectUnreachable(d) {
  if (G.stageId !== "stage2" || d.type !== "lamp") return false;
  const cp = Object.keys(CP_DEVICE).find(k => CP_DEVICE[k] === d.target);
  return !!(cp && G.quarantined[cp]);
}

function submitReport(problems) {
  logAction("作業完了を申告した", "report");
  const missedDefects = G.defects.filter(d => !d.found && !defectUnreachable(d));
  const falseReports = G.reports.filter(r => r.defectIndex === null);
  const bigMisses = G.missLog.filter(m => m.level === "大").length;

  const reasons = [];
  if (problems.length) reasons.push(...problems.map(p => "未完了: " + p));
  if (missedDefects.length) reasons.push(...missedDefects.map(d => "見逃し: " + d.name));
  if (falseReports.length) reasons.push(...falseReports.map(r => "誤記録(実際は正常): " + r.desc));
  if (bigMisses > 0) reasons.push(`大ミス ${bigMisses}回(発煙・発火事故)`);

  const pass = reasons.length === 0;
  finishStage(pass, reasons, missedDefects);
}

// 誤記録した時の解説(kind別)
const FALSE_REPORT_LESSON = {
  mawarikomi: "電源やコイルを経由した「回り込み」で見えた抵抗値。CPをOFFにして測り直すと消える正常な値で、短絡ではない。",
  "cp-off": "その回路はCPを経由している。CPがOFFだと導通しないのは当然で、不良ではない。CPをONにしてから測る。",
};

// ---------------- 結果画面 ----------------
function finishStage(pass, reasons, missedDefects) {
  clearInterval(loopId);
  closeAllModals();
  const timeSec = Math.floor((Date.now() - G.startTime) / 1000);
  const misses = {
    light: G.missLog.filter(m => m.level === "軽").length,
    mid: G.missLog.filter(m => m.level === "中").length,
    big: G.missLog.filter(m => m.level === "大").length,
  };
  saveRecord(G.stageId, {
    date: new Date().toISOString().slice(0, 10),
    pass, score: G.score, timeSec, misses, npcCalls: G.npcCalls
  });

  if (pass) Sfx.pass(); else Sfx.fail();

  const box = $("#result-box");
  let html = `<h2 class="${pass ? "pass" : "fail"}">${pass ? "合格!" : "不合格…"}</h2>`;
  html += `<div class="result-stats">
    <span>スコア: ${G.score}点</span><span>時間: ${fmtTime(timeSec)}</span>
    <span>ミス: 軽${misses.light} / 中${misses.mid} / 大${misses.big}</span>
    <span>ベテランに聞いた回数: ${G.npcCalls}回</span>
  </div>`;

  if (!pass) {
    html += `<div class="reasons"><b style="color:var(--red)">不合格の理由:</b><ul>` +
      reasons.map(r => `<li>${esc(r)}</li>`).join("") + `</ul></div>`;
  }
  if (missedDefects && missedDefects.length) {
    html += `<div class="reasons"><b style="color:var(--accent)">見逃した不良と教訓:</b><ul>` +
      missedDefects.map(d => `<li>${esc(d.name)} — ${esc(d.lesson)}</li>`).join("") + `</ul></div>`;
  }
  const foundList = G.defects.filter(d => d.found);
  if (foundList.length) {
    html += `<div class="reasons"><b style="color:var(--green)">発見した不良:</b><ul>` +
      foundList.map(d => `<li>${esc(d.name)}</li>`).join("") + `</ul></div>`;
  }
  // 誤記録(正常なのに異常として記録)の解説
  const falseReports = G.reports.filter(r => r.defectIndex === null);
  if (falseReports.length) {
    html += `<div class="reasons"><b style="color:var(--accent)">誤って記録した箇所と解説:</b><ul>` +
      falseReports.map(r => `<li>${esc(r.desc)} — ${linkTerms(FALSE_REPORT_LESSON[r.kind] || "図面と照らすと、これは正常な状態だった。")}</li>`).join("") + `</ul></div>`;
  }
  if (!G.defects.length) {
    html += `<div class="reasons" style="color:var(--dim)">今回、盤に不良は仕込まれていなかった。「異常がないことを確認する」のも大事な仕事だ。</div>`;
  }

  // 模範手順との比較
  html += `<h3 style="color:var(--accent);margin-top:16px">模範手順との比較</h3>
    <table class="compare-table"><tr><th style="width:42%">模範手順</th><th style="width:30%">あなたの操作</th><th>コメント</th></tr>`;
  let lastT = -1; let orderNote = false;
  for (const step of G.stage.modelProcedure) {
    const hit = G.actionLog.find(l => l.modelId === step.id);
    let cell, cls;
    if (hit) {
      cls = "did";
      cell = `${fmtTime(hit.t)} 実施`;
      if (hit.t < lastT) { cell += "(順序が模範と違う)"; orderNote = true; }
      lastT = Math.max(lastT, hit.t);
    } else {
      cls = "skip"; cell = "実施せず";
    }
    html += `<tr><td>${esc(step.label)}</td><td class="${cls}">${cell}</td><td>${esc(step.comment)}</td></tr>`;
  }
  html += `</table>`;
  if (orderNote) html += `<div class="zumen-note">※模範手順は「安全確認 → 測定 → 後始末」の順。結果オーライな時もあるが、順序には意味がある。</div>`;

  // 操作ログ全文(折りたたみ)
  html += `<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--dim)">あなたの操作ログ全体を見る(${G.actionLog.length}件)</summary>
    <div style="font-size:12px;color:var(--dim);line-height:1.8;margin-top:8px">` +
    G.actionLog.map(l => `${fmtTime(l.t)} ${esc(l.text)}`).join("<br>") + `</div></details>`;

  html += `<div class="footer">
    <button id="res-retry" class="primary">もう一度挑戦(不良は変わる)</button>
    <button id="res-select">ステージ選択へ</button>
  </div>`;

  box.innerHTML = html;
  show("screen-result");
  $("#res-retry").onclick = () => startBriefing(G.stage);
  $("#res-select").onclick = () => { renderStageSelect(); show("screen-select"); };
  setTimeout(() => $("#res-retry").focus(), 0);
}

// ---------------- NPCチャット ----------------
function npcStateSummary() {
  return {
    stageId: G.stageId,
    stageTitle: G.stage.title,
    hasTester: G.inventory.tester,
    leverChecked: G.flags.leverChecked,
    noVoltDone: stage1NoVoltDone(),
    cpOn: G.cpEverOn.CP1 && G.cpEverOn.CP2,
    cpStates: { ...G.cps },
    contDone: G.stageId === "stage1" ? stage1ContDone() : undefined,
    contProgress: `${S1_CONT_NETS.filter(n => G.contDone.has(n)).length}/${S1_CONT_NETS.length}`,
    shortDone: G.stageId === "stage1" ? stage1ShortDone() : undefined,
    cpAllOff: cpAllOff(),
    sourceOn: G.flags.sourceOn,
    mainOn: G.flags.mainOn,
    cpAllChecked: G.stageId === "stage2" ? stage2Requirements().cpsHandled : undefined,
    voltDone: G.stageId === "stage2" ? stage2Requirements().voltOk : undefined,
    recordedReports: G.reports.map(r => r.desc),
    recentActions: G.actionLog.slice(-8).map(l => l.text),
    recentMisses: G.missLog.slice(-3),
    defects: G.defects.map(d => ({ name: d.name, found: d.found })), // AI用の正解情報(直接教えない指示付き)
  };
}

function openChat() {
  G.npcCalls++;
  logAction("ベテランに話しかけた", null);
  renderChat();
  openModal("modal-chat");
  if (!G.chatHistory.length) {
    addChatMsg("assistant", "おう、どうした。手が止まってるみたいだな。…何が分からないか、言ってみろ。");
  }
  $("#chat-input").focus();
}
function renderChat() {
  const log = $("#chat-log");
  log.innerHTML = "";
  for (const m of G.chatHistory) {
    const div = document.createElement("div");
    div.className = "chat-msg " + (m.role === "user" ? "me" : "vet");
    div.innerHTML = `<span class="who">${m.role === "user" ? "あなた" : "ベテラン"}</span><br><span class="bubble">${linkTerms(m.text)}</span>`;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}
function addChatMsg(role, text) {
  G.chatHistory.push({ role, text });
  renderChat();
}
async function sendChat(presetText) {
  const input = $("#chat-input");
  const text = presetText || input.value.trim();
  if (!text) return;
  input.value = "";
  addChatMsg("user", text);
  Sfx.talk();
  const thinking = document.createElement("div");
  thinking.className = "chat-msg vet";
  thinking.innerHTML = `<span class="who">ベテラン</span><br><span class="bubble">(考え中…)</span>`;
  $("#chat-log").appendChild(thinking);
  $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  try {
    const res = await Veteran.ask(npcStateSummary(), G.chatHistory.slice(0, -1), text);
    thinking.remove();
    addChatMsg("assistant", res.text);
  } catch (e) {
    thinking.remove();
    addChatMsg("assistant", "…すまん、ちょっと耳が遠くてな(エラー)。もう一回頼む。");
  }
  Sfx.talk();
}
$("#chat-send").onclick = () => sendChat();
$("#chat-hint").onclick = () => sendChat("今、何をすればいいですか?");
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); sendChat(); }
  e.stopPropagation();
});
$("#chat-input").addEventListener("keyup", (e) => e.stopPropagation());

// ---------------- 用語ポップアップ ----------------
document.addEventListener("click", (e) => {
  const pop = $("#term-pop");
  const t = e.target.closest(".term");
  if (t) {
    const word = t.dataset.term;
    pop.innerHTML = `<b>${esc(word)}</b><br>${esc(GLOSSARY[word] || "")}`;
    pop.style.display = "block";
    const rect = t.getBoundingClientRect();
    pop.style.left = Math.min(rect.left, window.innerWidth - 340) + "px";
    pop.style.top = (rect.bottom + 6) + "px";
    e.stopPropagation();
  } else if (!e.target.closest("#term-pop")) {
    pop.style.display = "none";
  }
});

// ---------------- 設定 ----------------
function openSettings() {
  $("#set-apikey").value = localStorage.getItem("dn_apikey") || "";
  $("#set-sound").checked = Sfx.isEnabled();
  openModal("modal-settings");
}
$("#set-save").onclick = () => {
  const key = $("#set-apikey").value.trim();
  if (key) localStorage.setItem("dn_apikey", key);
  else localStorage.removeItem("dn_apikey");
  Sfx.setEnabled($("#set-sound").checked);
  localStorage.setItem("dn_sound", $("#set-sound").checked ? "1" : "0");
  toast("設定を保存した");
  closeModal("modal-settings");
};
$("#set-reset").onclick = () => {
  if (confirm("プレイ記録(クリア履歴・スコア)をすべて消去しますか?")) {
    localStorage.removeItem("dn_records");
    toast("記録をリセットした");
    renderStageSelect();
  }
};

// ---------------- チュートリアル ----------------
function openTutorial() { openModal("modal-tutorial"); }
$("#tut-close").onclick = () => closeModal("modal-tutorial");
$("#btn-tutorial").onclick = () => openTutorial();

// ---------------- 起動 ----------------
$("#btn-start").onclick = () => { renderStageSelect(); show("screen-select"); };
$("#btn-title-settings").onclick = () => openSettings();
$("#select-back").onclick = () => show("screen-title");
document.querySelectorAll(".modal-close").forEach(b => b.onclick = () => b.closest(".overlay").classList.remove("active"));

Sfx.setEnabled(localStorage.getItem("dn_sound") !== "0");
show("screen-title");
setTimeout(() => $("#btn-start").focus(), 0);
