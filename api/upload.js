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

    // POST to GAS — GAS processes the request then 302s to a result URL (fetched as GET)
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
      redirect: 'follow',
    });

    const text = await response.text();

    // Guard against HTML error pages (GAS auth errors, etc.)
    if (text.trimStart().startsWith('<')) {
      return res.status(502).json({ error: 'GAS returned an HTML response — check that the web app is deployed as "Anyone" and the URL is correct.' });
    }

    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
