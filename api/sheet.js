const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA/gviz/tq?tqx=out:json&gid=471942583';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const response = await fetch(SHEET_URL);
    const text = await response.text();
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
