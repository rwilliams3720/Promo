const DEFAULT_SHEET_ID = '1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA';
const GVZ_GID = '471942583';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const sid = (req.query && req.query.sid) || DEFAULT_SHEET_ID;
  const url = `https://docs.google.com/spreadsheets/d/${sid}/gviz/tq?tqx=out:json&gid=${GVZ_GID}`;
  try {
    const response = await fetch(url);
    const text = await response.text();
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
