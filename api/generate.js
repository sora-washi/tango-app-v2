export const config = { maxDuration: 30 };

// 優先順にモデルを試す（Vercelの環境変数 GEMINI_MODEL を設定すればそれが最優先）
const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'].filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { text, aiMode } = body || {};

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'サーバーにAPIキーが設定されていません。' });

  const lines = String(text || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100);
  if (!lines.length) return res.status(400).json({ error: '入力が空です。' });
  const list = lines.join('\n');

  const prompt = aiMode === 'manual'
    ? `以下は「単語 意味」のペアのリストです。各行について、意味が明らかに間違っていないか確認し、入力と同じ順番・同じ件数で返してください。間違っていれば isCorrect を false にして suggestion に正しい日本語の意味を入れてください。JSON配列のみ返すこと。形式: [{"q":"単語","a":"元の意味","isCorrect":true,"suggestion":""}]\n\n${list}`
    : `以下の単語リストそれぞれに、一般的な日本語の意味を付けてください。入力と同じ順番・同じ件数で、JSON配列のみ返すこと。形式: [{"q":"単語","a":"意味"}]\n\n${list}`;

  let lastError = 'AIから応答がありませんでした。';
  for (const model of MODELS) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192 }
        })
      });
      const data = await r.json();
      if (data.error) {
        lastError = data.error.message;
        if (r.status === 404 || data.error.status === 'NOT_FOUND') continue; // 存在しない/廃止モデル → 次へ
        break;
      }
      const raw = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      const m = raw.match(/\[[\s\S]*\]/);
      if (!m) { lastError = 'AIの返答を解析できませんでした。'; break; }
      const parsed = JSON.parse(m[0]);
      if (!Array.isArray(parsed)) { lastError = 'AIの返答の形式が不正です。'; break; }
      return res.status(200).json({ result: parsed, model });
    } catch (e) {
      lastError = e.message;
    }
  }
  return res.status(500).json({ error: lastError });
}
