import express from 'express';
import type { Request, Response } from 'express';
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
app.post('/api/convert', upload.array('images'), async (req: any, res: Response) => {
  try {
    const files = req.files as any[] | undefined;
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

// API Endpoint for Groq AI styling & optimization
app.post('/api/groq-stylist', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-groq-api-key'] as string || process.env.GROQ_API_KEY;
  const { svg, prompt, model } = req.body;

  if (!apiKey) {
    return res.status(400).json({ error: 'Groq API Key is required. Please input your key in the settings panel.' });
  }
  if (!svg || !prompt) {
    return res.status(400).json({ error: 'SVG content and styling prompt are required.' });
  }

  const selectedModel = model || 'meta-llama/llama-4-scout-17b-16e-instruct';

  try {
    const systemPrompt = `You are an expert SVG artist, front-end stylist, and graphic designer.
Your task is to modify the provided monochrome black and white SVG according to the user's design instructions (e.g., coloring, rendering gradients, adding outlines, modern accents, beautiful circular backgrounds, shadows, high-tech effects, or glowing styles).
CRITICAL RULES:
1. Preserve the original <path d="..."> coordinates layout perfectly. Do not distort, remove, or modify the core shapes, just color and enhance them!
2. You can add <defs> with gorgeous color gradients (linearGradient or radialGradient), glow-filters, and set fill="url(#gradient-id)" or stroke="url(#gradient-id)".
3. You can wrap the icon in a beautiful styled group <g> or add a colored background shape (like a soft modern rounded rectangle or circle) behind it.
4. Ensure the root <svg> has proper width, height, viewBox, and looks pristine with high contrast.
5. Return ONLY the final raw modified XML/SVG code enclosed within a markdown code block starting with \`\`\`xml and ending with \`\`\`. Do not include ANY intro, summary, or developer footnotes.`;

    const userContent = `User input style request: "${prompt}"

Input SVG Code:
\`\`\`xml
${svg}
\`\`\``;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        temperature: 0.25,
        max_tokens: 4096,
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Groq error: ${errorText}` });
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Extract SVG from markdown code blocks
    let enhancedSvg = '';
    const match = content.match(/```xml\s*([\s\S]*?)\s*```/) || 
                  content.match(/```html\s*([\s\S]*?)\s*```/) || 
                  content.match(/<svg[\s\S]*<\/svg>/);

    if (match) {
      enhancedSvg = match[1] ? match[1].trim() : match[0].trim();
    } else {
      enhancedSvg = content.trim();
    }

    if (!enhancedSvg.startsWith('<svg') && enhancedSvg.includes('<svg')) {
      const startIdx = enhancedSvg.indexOf('<svg');
      const endIdx = enhancedSvg.lastIndexOf('</svg>');
      if (startIdx !== -1 && endIdx !== -1) {
        enhancedSvg = enhancedSvg.substring(startIdx, endIdx + 6);
      }
    }

    if (!enhancedSvg.startsWith('<svg')) {
      return res.status(422).json({ error: 'AI did not return a valid SVG root tag. Please try a different styling instruction.' });
    }

    res.json({ svg: enhancedSvg });
  } catch (error: any) {
    console.error('Groq AI styling error:', error);
    res.status(500).json({ error: error.message || 'Internal server error during AI styling' });
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
