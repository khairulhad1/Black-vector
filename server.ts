import express, { Request, Response } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import potrace from 'potrace';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Set up Multer for handling multiple file uploads in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit per file
});

// Conversion Logic
const vectorizeImage = (buffer: Buffer, options: any): Promise<string> => {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, options, (err: any, svg: string) => {
      if (err) reject(err);
      else resolve(svg);
    });
  });
};

// API Endpoint for single/multiple image conversion
app.post('/api/convert', upload.array('images'), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No images uploaded' });
    }

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          // 1. Process image with Sharp (grayscale and thresholding)
          // We don't have direct Otsu here, but Sharp's thresholding is very effective.
          const processedBuffer = await sharp(file.buffer)
            .greyscale()
            .toBuffer();

          // 2. Vectorize with Potrace
          const svg = await vectorizeImage(processedBuffer, {
            turdSize: 2,
            optTolerance: 0.2,
          });

          return {
            name: path.parse(file.originalname).name + '.svg',
            data: svg,
            originalName: file.originalname,
          };
        } catch (err) {
          console.error(`Error processing ${file.originalname}:`, err);
          return {
            name: file.originalname,
            error: 'Failed to process',
          };
        }
      })
    );

    res.json({ results });
  } catch (error) {
    console.error('Batch error:', error);
    res.status(500).json({ error: 'Server error during vectorization' });
  }
});

async function start() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

start();
