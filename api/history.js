const GAS_URL = process.env.GAS_UPLOAD_URL;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (!GAS_URL) {
    return res.status(500).json({ error: 'GAS_UPLOAD_URL not configured.' });
  }

  try {
    const action = (req.query && req.query.action) || 'history';
    const response = await fetch(GAS_URL + '?action=' + action, { redirect: 'follow' });
    const text = await response.text();

    if (text.trimStart().startsWith('<')) {
      return res.status(502).json({ error: 'GAS returned HTML — check deployment settings.' });
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
