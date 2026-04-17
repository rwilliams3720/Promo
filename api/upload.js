export const config = {
  api: { bodyParser: { sizeLimit: '15mb' } },
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
    const response = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      redirect: 'follow',
    });
    const text = await response.text();
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
