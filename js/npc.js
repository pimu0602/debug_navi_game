// ============================================================
// ベテランNPC(定型ヒント+Claude API接続)
// - APIキー未設定時は定型の「着眼点ヒント」を段階表示(フォールバック)
// - APIキー設定時はClaude APIで自然な会話(ゲーム状態をコンテキストに渡す)
// ============================================================
const Veteran = (() => {

  // ---- 定型ヒントエンジン(フォールバック) ----
  // ゲーム状態を見て、いま一番先にやるべきことへの「着眼点」を返す。
  // 同じ状況で2回聞かれたら、より具体的なヒントに深める(3-3のルール②)
  const askCounts = {};

  function cannedHint(state) {
    const hints = pickHintTopic(state);
    const key = hints.key;
    askCounts[key] = (askCounts[key] || 0) + 1;
    const depth = Math.min(askCounts[key], hints.levels.length);
    return hints.levels[depth - 1];
  }

  function pickHintTopic(state) {
    const s = state;
    if (s.stageId === "stage1") {
      if (!s.hasTester) return { key: "tools", levels: [
        "ん?手ぶらか。現場に入る前に、まず何を持つんだったかな。",
        "工具置き場を見てこい。テスターとペンがないと始まらんぞ。"
      ]};
      if (!s.leverChecked) return { key: "lever", levels: [
        "焦るな。電気の仕事で一番最初に確認することは何だ?",
        "主電源のブレーカーだ。レバーがどっちを向いてるか、自分の目で見てこい。"
      ]};
      if (!s.noVoltDone) return { key: "novolt", levels: [
        "レバーを見ただけで安心するなよ。「見た目」と「実際」は違うことがある。",
        "テスターのVレンジ(AC)で主回路の相間を当たれ。R-S、S-T、R-Tの三相だ。ここが無電圧なら上流が切れてる証拠、下流の制御回路にも電圧は来ていない。安心してCPを上げられる。"
      ]};
      if (!s.cpOn) return { key: "cpon", levels: [
        "導通チェックの前に、回路の準備はできてるか?図面は見たか?",
        "導通確認に必要なCPだけをONにするんだ。図面を見ればどれが必要か分かる。不要なやつは触るな。"
      ]};
      if (!s.contDone) return { key: "cont", levels: [
        "地道な作業だが、同じ線番どうしが全部つながってるか、1本ずつ確認するんだ。",
        "Ωレンジで同線番の盤側と機器側を当たれ。ピーと鳴れば導通あり。鳴らなかったら…それが今日の宿題だ。"
      ]};
      if (!s.shortDone) return { key: "short", levels: [
        "つながってるべき所を確認したら、次は「つながってちゃいけない所」だ。",
        "異線番どうし(R-Sとか)と、電源線とE間を当たれ。原則鳴らないはずだ。抵抗値が見えたら図面と照合して考えろ。CPをOFFにすると消える値なら、それは回り込みだ。"
      ]};
      if (!s.cpAllOff) return { key: "cpoff", levels: [
        "確認が終わったら、最後にやることがあるだろう。",
        "ONにしたCPを全部OFFに戻せ。次の電源投入で泣きを見るぞ。"
      ]};
      return { key: "report", levels: [
        "一通り終わったみたいだな。異常は見つけたか?「異常がない」と確認するのも仕事のうちだぞ。",
        "自信があるなら作業完了を申告しろ。記録した異常があれば一緒に報告するんだ。"
      ]};
    }
    // stage2
    if (!s.hasTester) return { key: "tools2", levels: [
      "今日も手ぶらか?道具の準備からだ。",
      "工具置き場でテスターとペンを取ってこい。"
    ]};
    if (!s.sourceOn) return { key: "source", levels: [
      "電源投入は順番が命だ。どこから電気は来る?",
      "壁の元電源(一次電源)からだ。入れる前に、盤の中に工具や忘れ物がないか見ておけよ。"
    ]};
    if (!s.mainOn) return { key: "main", levels: [
      "元電源が入ったな。次はどこだ?",
      "制御盤の主電源だ。入れた瞬間の音と匂いに集中しろ。異常があったらすぐ切れ。"
    ]};
    if (!s.cpAllChecked) return { key: "cpeach", levels: [
      "CPはどう入れるんだったかな。まとめてガチャッと…はダメだぞ。",
      "1つずつONして、そのたびに対象機器のランプを確認するんだ。どのCPで異常が出たか分かるようにな。"
    ]};
    if (!s.voltDone) return { key: "volt", levels: [
      "ランプが点いたからって安心するな。ランプは「電気が来てる」ことしか教えてくれん。",
      "テスターで電圧を実測しろ。主回路の相間(R-S・S-T・R-T)はAC200V、L-N間はAC100V、P-0V間はDC24V。レンジ間違いに気をつけろ。"
    ]};
    return { key: "report2", levels: [
      "一通り確認できたか?異常があったなら記録は残してあるな?",
      "よし、作業完了を申告してこい。"
    ]};
  }

  // ---- Claude API接続 ----
  function buildSystemPrompt(state) {
    return `あなたは工場の制御盤立ち上げ歴30年のベテラン技術者です。新人教育ゲームのNPCとして、休憩スペースで新人プレイヤーの質問に答えます。

## 話し方
- ぶっきらぼうだが面倒見のいい先輩口調。短めに話す(2〜4文)
- 専門用語は使ってよいが、聞かれたらやさしく言い換える

## 指導方針(厳守)
1. 答えを即答しない。まず考え方・着眼点を教える
2. 同じことを2回聞かれたら、より具体的なヒントを出す
3. プレイヤーが危険な操作をしようとしていたら、はっきり強く止める
4. 手順書の考え方(主電源OFF確認→無電圧確認→導通チェック→CP戻し、電源は一次側から順に投入、CPは1つずつ等)に沿って導く

## 現在のゲーム状況(これを踏まえて答える)
${JSON.stringify(state, null, 2)}

※ state.defects は盤に仕込まれた不良の正解情報です。絶対に直接教えないこと。プレイヤーが正しい測定で自力発見できるよう着眼点だけ示すこと。`;
  }

  async function askClaude(state, history, userText, apiKey) {
    const messages = history.slice(-12).map(m => ({ role: m.role, content: m.text }));
    messages.push({ role: "user", content: userText });

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: "claude-opus-4-8",
        max_tokens: 600,
        system: buildSystemPrompt(state),
        messages
      })
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`API ${res.status}: ${errBody.slice(0, 200)}`);
    }
    const data = await res.json();
    const textBlock = (data.content || []).find(b => b.type === "text");
    if (data.stop_reason === "refusal" || !textBlock) {
      throw new Error("応答が得られませんでした");
    }
    return textBlock.text;
  }

  // ---- 公開API ----
  // ask(): APIキーがあればClaude、失敗・未設定なら定型ヒント
  async function ask(state, history, userText) {
    const apiKey = (localStorage.getItem("dn_apikey") || "").trim();
    if (apiKey) {
      try {
        return { text: await askClaude(state, history, userText, apiKey), source: "ai" };
      } catch (e) {
        console.warn("Claude API失敗、定型ヒントに切替:", e);
        return { text: cannedHint(state) + "\n(※AI接続に失敗したため定型ヒントで応答しています)", source: "fallback" };
      }
    }
    return { text: cannedHint(state), source: "canned" };
  }

  function resetCounts() {
    for (const k of Object.keys(askCounts)) delete askCounts[k];
  }

  return { ask, resetCounts };
})();
