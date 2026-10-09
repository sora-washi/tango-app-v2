export const config = { maxDuration: 30 };

// 優先順にモデルを試す（Vercelの環境変数 GEMINI_MODEL を設定すればそれが最優先）
const MODELS = [process.env.GEMINI_MODEL, 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-3.5-flash'].filter(Boolean);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const aiMode = body.aiMode;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'サーバーにAPIキーが設定されていません。' });

  // items: [{ q: 英語の単語・フレーズ, a: 日本語の意味 }]（古いクライアントの text にも対応）
  let items = Array.isArray(body.items)
    ? body.items
    : String(body.text || '').split('\n').map(l => ({ q: l.trim(), a: '' }));
  items = items
    .map(i => ({ q: String(i?.q ?? '').trim().slice(0, 200), a: String(i?.a ?? '').trim().slice(0, 200) }))
    .filter(i => i.q)
    .slice(0, 100);
  if (!items.length) return res.status(400).json({ error: '入力が空です。' });

  const prompt = aiMode === 'manual'
    ? `以下は「英語の単語またはフレーズ | 日本語の意味」のリストです。各項目について、意味が明らかに間違っていないか確認してください。\n` +
      `・入力と同じ順番・同じ件数で、JSON配列のみ返すこと。q は入力のまま変更しないこと。\n` +
      `・間違っていれば isCorrect を false にして、suggestion に正しい日本語の意味を入れること。\n` +
      `・意味が空の項目は isCorrect を false にして、suggestion に自然な日本語の意味を入れること。\n` +
      `・フレーズは、フレーズ全体の意味で判断すること。\n` +
      `形式: [{"q":"...","a":"元の意味","isCorrect":true,"suggestion":""}]\n\n` +
      items.map((it, n) => `${n + 1}. ${it.q} | ${it.a}`).join('\n')
    : `以下の英語の単語またはフレーズそれぞれに、自然で一般的な日本語の意味を付けてください。\n` +
      `・フレーズは、フレーズ全体の意味にすること（単語ごとに分けない）。\n` +
      `・入力と同じ順番・同じ件数で、JSON配列のみ返すこと。q は入力のまま変更しないこと。\n` +
      `形式: [{"q":"...","a":"意味"}]\n\n` +
      items.map((it, n) => `${n + 1}. ${it.q}`).join('\n');

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
