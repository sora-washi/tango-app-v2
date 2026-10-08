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

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: promptStr }] }] })
    });

    const data = await response.json();
    if (data.error) {
      return res.status(500).json({ error: data.error.message });
    }

    let rawJson = data.candidates[0].content.parts[0].text;
    rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(rawJson);

    res.status(200).json({ result: parsed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
