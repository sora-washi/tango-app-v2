export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { text, aiMode } = req.body;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'サーバーにAPIキーが設定されていません。' });
  }

  let promptStr = "";
  if (aiMode === 'manual') {
    promptStr = `以下の「単語 意味」のペアをチェックし、意味が明らかに間違っていれば修正案を出して。JSON配列のみ返して。[{"q":"単語","a":"元の意味","isCorrect":true/false,"suggestion":"正しい意味（間違ってる場合）"}]\n${text}`;
  } else {
    promptStr = `以下の単語リストに対する一般的な日本語の意味を生成して。JSON配列のみ返して。[{"q":"単語","a":"生成した意味"}]\n${text}`;
  }

  // ※モデル名はご自身の環境で一番安定して動いているものを指定してください
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${apiKey}`;

  // ▼ ここからが高負荷対策（自動リトライ機能） ▼
  const maxRetries = 3; // 最大3回まで自動で挑戦する

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: promptStr }] }] })
      });

      const data = await response.json();

      // エラー時の処理（高負荷: 503, 制限オーバー: 429など）
      if (!response.ok || (data.error && data.error.message.includes("high demand"))) {
        
        // 最後の挑戦（3回目）でもダメだった場合はユーザーにエラーを返す
        if (attempt === maxRetries) {
          return res.status(503).json({ error: 'AIサーバーが大変混み合っています。数分後にもう一度お試しください。' });
        }
        
        // 待機時間を作る（1回失敗したら1秒待ち、2回目は2秒待ってから再リクエスト）
        console.log(`${attempt}回目の通信失敗。再試行します...`);
        await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        continue; // もう一度 fetch を実行する
      }

      // 正常にデータが取れた場合の処理
      let rawJson = data.candidates[0].content.parts[0].text;
      rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(rawJson);

      return res.status(200).json({ result: parsed });

    } catch (error) {
      // ネットワーク自体のエラーの場合も同様にリトライ
      if (attempt === maxRetries) {
        return res.status(500).json({ error: error.message });
      }
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
}
