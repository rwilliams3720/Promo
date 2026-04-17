export const config = {
  api: { bodyParser: false },
};

const GAS_URL = process.env.GAS_UPLOAD_URL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!GAS_URL) {
    return res.status(500).json({ error: 'GAS_UPLOAD_URL not configured in Vercel environment variables.' });
  }

  try {
    // Stream raw body — avoid re-serializing the already-encoded JSON
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks);

    // Send to GAS with manual redirect handling — 'follow' converts POST→GET on 302
    let response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const redirectUrl = response.headers.get('location');
      if (redirectUrl) {
        response = await fetch(redirectUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: rawBody,
        });
      }
    }

    const text = await response.text();
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
