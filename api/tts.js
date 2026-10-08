export const config = { maxDuration: 30 };

// 声の設定（Vercelの環境変数で変更できる）
const CLOUD_VOICES = {
  en: { languageCode: 'en-US', name: process.env.TTS_VOICE_EN || 'en-US-Neural2-F' },
  ja: { languageCode: 'ja-JP', name: process.env.TTS_VOICE_JA || 'ja-JP-Neural2-B' }
};
const GEMINI_TTS_MODELS = [process.env.GEMINI_TTS_MODEL, 'gemini-3.1-flash-tts-preview', 'gemini-2.5-flash-preview-tts'].filter(Boolean);

export default async function handler(req, res) {
  const text = String(req.query.text || '').trim().slice(0, 200);
  // 日本語の文字が入っていれば日本語、なければ英語（クライアントの指定に関係なく、文字から判定する）
  const lang = /[\u3040-\u30ff\u3400-\u9fff]/.test(text) ? 'ja' : 'en';
  if (!text) return res.status(400).json({ error: 'text is required' });

  try {
    // GOOGLE_TTS_API_KEY があればGoogle Cloud TTS、なければGeminiのTTS（GEMINI_API_KEY）を使う
    const audio = process.env.GOOGLE_TTS_API_KEY ? await cloudTts(text, lang) : await geminiTts(text, lang);
    res.setHeader('Content-Type', audio.type);
    res.setHeader('X-TTS-Engine', process.env.GOOGLE_TTS_API_KEY ? 'google-cloud' : 'gemini');
    // 同じ単語は全ユーザーで1回だけ生成すれば済むように、CDNとブラウザに長期キャッシュさせる
    res.setHeader('Cache-Control', 'public, max-age=31536000, s-maxage=31536000, immutable');
    return res.status(200).send(audio.buffer);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: e.message });
  }
}

async function cloudTts(text, lang) {
  const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GOOGLE_TTS_API_KEY },
    body: JSON.stringify({ input: { text }, voice: CLOUD_VOICES[lang], audioConfig: { audioEncoding: 'MP3' } })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'Cloud TTS error');
  return { type: 'audio/mpeg', buffer: Buffer.from(d.audioContent, 'base64') };
}

async function geminiTts(text, lang) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('APIキーが設定されていません。');
  const prompt = (lang === 'ja' ? 'Say clearly in Japanese: ' : 'Say clearly in English: ') + text;
  let lastError = 'Gemini TTS error';
  for (const model of GEMINI_TTS_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.GEMINI_TTS_VOICE || 'Kore' } } }
        }
      })
    });
    const d = await r.json();
    if (!r.ok) { lastError = d.error?.message || lastError; if (r.status === 404) continue; break; }
    const part = d.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (!part) { lastError = '音声が返ってきませんでした。'; break; }
    return { type: 'audio/wav', buffer: pcmToWav(Buffer.from(part.inlineData.data, 'base64'), 24000) };
  }
  throw new Error(lastError);
}

// GeminiのTTSは生のPCM(24kHz/16bit/モノラル)で返るので、再生できるようWAVのヘッダーを付ける
function pcmToWav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
