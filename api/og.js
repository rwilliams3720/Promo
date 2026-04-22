import sharp from 'sharp';
import { readFileSync } from 'fs';
import path from 'path';

export default async function handler(req, res) {
  try {
    const svgPath = path.join(process.cwd(), 'og.svg');
    const svg = readFileSync(svgPath);
    const png = await sharp(Buffer.from(svg), { density: 144 })
      .resize(1200, 630)
      .png()
      .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(png);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
