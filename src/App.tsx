import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Trash2, 
  Download, 
  FileImage, 
  Loader2, 
  CheckCircle2, 
  XCircle,
  FolderDown,
  Info,
  Sparkles,
  Key,
  Settings,
  Eye,
  EyeOff,
  RefreshCw,
  Palette,
  X,
  Play,
  Sliders,
  Sparkle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';

interface Point {
  x: number;
  y: number;
}

interface ProcessedFile {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  data?: string; // Original black & white SVG content
  styledData?: string; // AI Styled SVG content
  styledPrompt?: string; // Prompt used for styling
  error?: string;
  fileObj: File;
}

// ─── ALGORITMA VECTORISASI CLIENT-SIDE (100% OFFLINE / STATIC OPTIMIZED) ───

function findOtsuThreshold(grayscale: Uint8ClampedArray): number {
  const hist = new Int32Array(256);
  for (let i = 0; i < grayscale.length; i++) {
    hist[grayscale[i]]++;
  }
  const total = grayscale.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    sum += i * hist[i];
  }
  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = 0;
  let threshold = 127;

  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > varMax) {
      varMax = varBetween;
      threshold = i;
    }
  }
  return threshold;
}

function getSquareSegmentDistance(p: Point, p1: Point, p2: Point) {
  let x = p1.x;
  let y = p1.y;
  let dx = p2.x - x;
  let dy = p2.y - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.x;
      y = p2.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p.x - x;
  dy = p.y - y;
  return dx * dx + dy * dy;
}

function rdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points;

  let maxSqDist = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const sqDist = getSquareSegmentDistance(points[i], points[0], points[end]);
    if (sqDist > maxSqDist) {
      index = i;
      maxSqDist = sqDist;
    }
  }

  if (maxSqDist > epsilon * epsilon) {
    const results1 = rdp(points.slice(0, index + 1), epsilon);
    const results2 = rdp(points.slice(index), epsilon);
    return results1.slice(0, results1.length - 1).concat(results2);
  } else {
    return [points[0], points[end]];
  }
}

function vectorizeImageClient(
  file: File, 
  options: { threshold?: number; useOtsu: boolean; epsilon: number }
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        // Skala resolusi agar performance browser lancar, pertahankan grafis tajam
        const maxDim = 800; 
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Konteks Canvas tidak tersedia'));
          return;
        }

        // Gambar latar putih default untuk menangani transparansi PNG
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;

        // Konversi ke Grayscale (Grayscale-Luminance Blend)
        const grayscale = new Uint8ClampedArray(w * h);
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3] / 255;
          const gray = Math.round((0.299 * r + 0.587 * g + 0.114 * b) * a + 255 * (1 - a));
          grayscale[i / 4] = gray;
        }

        // Tentukan nilai threshold kontras
        const threshold = options.useOtsu ? findOtsuThreshold(grayscale) : (options.threshold ?? 127);

        // Grid Piksel Biner (1 untuk Hitam / di bawah threshold, 0 untuk Putih / di atas)
        const binary = new Uint8Array(w * h);
        for (let i = 0; i < grayscale.length; i++) {
          binary[i] = grayscale[i] < threshold ? 1 : 0;
        }

        const getVal = (x: number, y: number): number => {
          if (x < 0 || x >= w || y < 0 || y >= h) return 0;
          return binary[y * w + x];
        };

        // Simpan outgoing segment koordinat (topologi graph)
        const outgoing = new Map<number, number[]>();
        const getKey = (x: number, y: number) => y * (w + 2) + x;

        // Bentuk Garis Vertikal (Batas kiri & kanan piksel hitam)
        for (let y = 0; y < h; y++) {
          for (let x = 0; x <= w; x++) {
            const left = getVal(x - 1, y);
            const right = getVal(x, y);
            if (left !== right) {
              const pStart = right === 1 ? getKey(x, y) : getKey(x, y + 1);
              const pEnd = right === 1 ? getKey(x, y + 1) : getKey(x, y);
              
              const list = outgoing.get(pStart) || [];
              list.push(pEnd);
              outgoing.set(pStart, list);
            }
          }
        }

        // Bentuk Garis Horizontal (Batas atas & bawah piksel hitam)
        for (let y = 0; y <= h; y++) {
          for (let x = 0; x < w; x++) {
            const top = getVal(x, y - 1);
            const bottom = getVal(x, y);
            if (top !== bottom) {
              const pStart = bottom === 1 ? getKey(x, y) : getKey(x + 1, y);
              const pEnd = bottom === 1 ? getKey(x + 1, y) : getKey(x, y);
              
              const list = outgoing.get(pStart) || [];
              list.push(pEnd);
              outgoing.set(pStart, list);
            }
          }
        }

        const getCoords = (key: number) => {
          const x = key % (w + 2);
          const y = Math.floor(key / (w + 2));
          return { x, y };
        };

        const paths: Point[][] = [];
        
        for (const [startKey, list] of outgoing.entries()) {
          while (list && list.length > 0) {
            const currentPathKeys: number[] = [];
            let curr = startKey;
            
            let nextList = outgoing.get(curr);
            while (nextList && nextList.length > 0) {
              const nextVal = nextList.pop()!;
              currentPathKeys.push(curr);
              curr = nextVal;
              nextList = outgoing.get(curr);
              
              if (curr === startKey) {
                currentPathKeys.push(curr);
                break;
              }
              
              if (currentPathKeys.includes(curr)) {
                currentPathKeys.push(curr);
                break;
              }
            }

            if (currentPathKeys.length >= 3) {
              paths.push(currentPathKeys.map(getCoords));
            }
          }
        }

        // Sederhanakan kelokan bergerigi dengan RDP
        const smoothedPaths = paths.map(p => rdp(p, options.epsilon));

        // Buat file XML SVG output
        let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" height="100%">\n`;
        svgContent += `  <rect width="${w}" height="${h}" fill="none" />\n`;
        
        let pathD = '';
        smoothedPaths.forEach(pts => {
          if (pts.length < 2) return;
          pathD += `M ${pts[0].x} ${pts[0].y} `;
          for (let i = 1; i < pts.length; i++) {
            pathD += `L ${pts[i].x} ${pts[i].y} `;
          }
          pathD += `Z `;
        });

        if (pathD) {
          svgContent += `  <path d="${pathD.trim()}" fill="#000000" fill-rule="evenodd" />\n`;
        }
        svgContent += `</svg>`;

        resolve(svgContent);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Format file tidak didukung / gambar gagal dimuat'));
    };
    img.src = url;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mode konversi default: Client-side (Instan, 100% Offline, Netlify Ideal)
  const [conversionMode, setConversionMode] = useState<'client' | 'server'>('client');

  // Vectorization parameters
  const [useOtsu, setUseOtsu] = useState<boolean>(true);
  const [threshold, setThreshold] = useState<number>(127);
  const [smoothing, setSmoothing] = useState<number>(1.2);

  // Groq API Configuration
  const [groqKey, setGroqKey] = useState<string>(() => localStorage.getItem('groq_api_key') || '');
  const [groqModel, setGroqModel] = useState<string>(() => localStorage.getItem('groq_model') || 'meta-llama/llama-4-scout-17b-16e-instruct');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);

  // Styling modal state
  const [activeStylingFile, setActiveStylingFile] = useState<ProcessedFile | null>(null);
  const [stylingPrompt, setStylingPrompt] = useState<string>('');
  const [isStyling, setIsStyling] = useState<boolean>(false);
  const [stylingError, setStylingError] = useState<string>('');

  // Suggestions for prompt
  const styleSuggestions = [
    'Mewarnai emas logam yang mengkilap dengan bayangan 3D lembut',
    'Tambahkan lingkaran background neon futuristik berwarna biru siber dan ungu',
    'Ubah garis luar (stroke) menjadi merah menyala dengan gradasi jingga',
    'Desain monokromatik bergaya retro vintage menggunakan palet warna cream & bronze',
    'Gaya kartun warna-warni cerah dengan border luar hitam tebal',
    'Tambahkan gradasi linear pelangi (rainbow gradient) di seluruh jalur gambar'
  ];

  // Save Groq configs
  useEffect(() => {
    localStorage.setItem('groq_api_key', groqKey);
  }, [groqKey]);

  useEffect(() => {
    localStorage.setItem('groq_model', groqModel);
  }, [groqModel]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files).map((file: File) => ({
        id: Math.random().toString(36).substring(2, 9),
        name: file.name,
        status: 'pending' as const,
        fileObj: file
      }));
      setFiles(prev => [...prev, ...newFiles as any]);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
    if (activeStylingFile?.id === id) {
      setActiveStylingFile(null);
    }
  };

  const clearAll = () => {
    setFiles([]);
    setActiveStylingFile(null);
  };

  const processFiles = async () => {
    const pending = files.filter(f => f.status === 'pending');
    if (pending.length === 0) return;

    setIsUploading(true);
    
    // Update status to processing
    setFiles(prev => prev.map(f => f.status === 'pending' ? { ...f, status: 'processing' } : f));

    if (conversionMode === 'client') {
      // PROSES 100% DI BROWSER CLIENT-SIDE (SANGAT COCOK UNTUK NETLIFY)
      for (const file of pending) {
        try {
          const svgResult = await vectorizeImageClient(file.fileObj, {
            useOtsu,
            threshold,
            epsilon: smoothing
          });

          setFiles(prev => prev.map(f => f.id === file.id ? {
            ...f,
            status: 'done',
            data: svgResult
          } : f));
        } catch (err: any) {
          console.error(`Gagal memproses ${file.name}:`, err);
          setFiles(prev => prev.map(f => f.id === file.id ? {
            ...f,
            status: 'error',
            error: err.message || 'Gagal merubah ke bentuk vector'
          } : f));
        }
      }
      setIsUploading(false);
    } else {
      // PROSES BACKEND (MODAL EXPREE SERVER FALLBACK)
      try {
        const formData = new FormData();
        pending.forEach(f => {
          formData.append('images', f.fileObj);
        });

        const response = await fetch('/api/convert', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();

        if (data.results) {
          setFiles(prev => {
            return prev.map(f => {
              const result = data.results.find((r: any) => r.originalName === f.name);
              if (result) {
                return {
                  ...f,
                  status: result.error ? 'error' : 'done',
                  data: result.data,
                  error: result.error
                };
              }
              return f;
            });
          });
        }
      } catch (error) {
        console.error('Error processing files via backend API:', error);
        setFiles(prev => prev.map(f => f.status === 'processing' ? { ...f, status: 'error', error: 'Sambungan server backend gagal' } : f));
      } finally {
        setIsUploading(false);
      }
    }
  };

  // Perform Groq AI styling (DIRECT CLIENT-SIDE call to allow serverless zero runtime error!)
  const applyAIStyling = async () => {
    if (!activeStylingFile || !activeStylingFile.data) return;
    if (!groqKey.trim()) {
      setStylingError('Harap masukkan Groq API Key terlebih dahulu di Panel Pengaturan.');
      return;
    }
    if (!stylingPrompt.trim()) {
      setStylingError('Harap tuliskan instruksi gaya atau warna baru.');
      return;
    }

    setIsStyling(true);
    setStylingError('');

    try {
      const systemPrompt = `You are an expert SVG artist, front-end stylist, and graphic designer.
Your task is to modify the provided monochrome black and white SVG according to the user's design instructions (e.g., coloring, rendering gradients, adding outlines, modern accents, beautiful circular backgrounds, shadows, high-tech effects, or glowing styles).
CRITICAL RULES:
1. Preserve the original <path d="..."> coordinates layout perfectly. Do not distort, remove, or modify the core shapes, just color and enhance them!
2. You can add <defs> with gorgeous color gradients (linearGradient or radialGradient), glow-filters, and set fill="url(#gradient-id)" or stroke="url(#gradient-id)".
3. You can wrap the icon in a beautiful styled group <g> or add a colored background shape (like a soft modern rounded rectangle or circle) behind it.
4. Ensure the root <svg> has proper width, height, viewBox, and looks pristine with high contrast.
5. Return ONLY the final raw modified XML/SVG code enclosed within a markdown code block starting with \`\`\`xml and ending with \`\`\`. Do not include ANY intro, summary, or developer footnotes.`;

      const userContent = `User input style request: "${stylingPrompt}"

Input SVG Code:
\`\`\`xml
${activeStylingFile.data}
\`\`\``;

      // Direct client call to avoid static hosting proxy failures on Netlify/Vercel!
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: groqModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
          ],
          temperature: 0.25,
          max_tokens: 4096,
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.error?.message || 'Gagal memproses AI styling dari API Groq.');
      }

      const content = result.choices?.[0]?.message?.content || '';

      // Extract SVG from markdown code block
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
        throw new Error('Hasil dekorasi AI tidak mengembalikan format tag <svg> yang valid.');
      }

      const updatedFile: ProcessedFile = {
        ...activeStylingFile,
        styledData: enhancedSvg,
        styledPrompt: stylingPrompt
      };

      setFiles(prev => prev.map(f => f.id === activeStylingFile.id ? updatedFile : f));
      setActiveStylingFile(updatedFile);
      setStylingPrompt('');
    } catch (error: any) {
      console.error('Styling error:', error);
      setStylingError(error.message || 'Gagal menghubungi Groq AI Stylist.');
    } finally {
      setIsStyling(false);
    }
  };

  const removeAIStyling = (fileId: string) => {
    setFiles(prev => prev.map(f => f.id === fileId ? { ...f, styledData: undefined, styledPrompt: undefined } : f));
    if (activeStylingFile?.id === fileId) {
      setActiveStylingFile(prev => prev ? { ...prev, styledData: undefined, styledPrompt: undefined } : null);
    }
  };

  const downloadSingle = (file: ProcessedFile, type: 'original' | 'styled' = 'original') => {
    const rawData = type === 'styled' && file.styledData ? file.styledData : file.data;
    if (!rawData) return;
    const blob = new Blob([rawData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const suffix = type === 'styled' ? '_styled' : '';
    a.download = file.name.split('.')[0] + suffix + '.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAll = async () => {
    const doneFiles = files.filter(f => f.status === 'done' && (f.data || f.styledData));
    if (doneFiles.length === 0) return;

    const zip = new JSZip();
    doneFiles.forEach(f => {
      const baseName = f.name.split('.')[0];
      if (f.styledData) {
        zip.file(baseName + '_styled_ai.svg', f.styledData);
      }
      if (f.data) {
        zip.file(baseName + '_bw.svg', f.data);
      }
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vectorized_bulk_images.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 font-sans p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        
        {/* Header Area */}
        <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-slate-200 pb-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="bg-blue-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">BULK APP</span>
              <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2.5 py-1 rounded-full border border-emerald-100 flex items-center gap-1">
                ✓ Static Hosting Ready (Netlify/Vercel)
              </span>
              <span className="text-slate-400 font-mono text-xs">Offline Trace &amp; Client Groq API</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900 mt-1">VectorBulk Studio</h1>
            <p className="text-slate-500 text-sm md:text-base mt-1">
              Konversi banyak gambar sekaligus ke vector hitam-putih 100% lokal di browser Anda, lalu warnai dengan AI Groq!
            </p>
          </div>

          {/* Quick Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                showSettings 
                  ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm' 
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Settings className="w-4 h-4" />
              Pengaturan &amp; Sliders
            </button>
          </div>
        </header>

        {/* Collapsible Groq Settings & Sliders Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-6"
            >
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5">
                
                {/* 1. Mode & Processing Parameters */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
                    <Sliders className="text-slate-700 w-4 h-4" />
                    <h3 className="font-bold text-slate-800 text-sm">Parameter Desain &amp; Vectorisasi</h3>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                    
                    {/* Mode selector */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5">Metode Proses</label>
                      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                        <button
                          type="button"
                          onClick={() => setConversionMode('client')}
                          className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all ${
                            conversionMode === 'client' 
                              ? 'bg-white text-slate-900 shadow-xs' 
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          Browser (Offline/Static)
                        </button>
                        <button
                          type="button"
                          onClick={() => setConversionMode('server')}
                          className={`flex-1 text-center py-1.5 text-xs font-bold rounded-lg transition-all ${
                            conversionMode === 'server' 
                              ? 'bg-white text-slate-900 shadow-xs' 
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          Backend Server
                        </button>
                      </div>
                      <span className="text-[10px] text-slate-400 mt-1 block leading-tight">
                        {conversionMode === 'client' 
                          ? 'Direkomendasikan! 100% instan lokal tanpa kuota upload.' 
                          : 'Memerlukan runtime Node express server.'}
                      </span>
                    </div>

                    {/* Thresholding */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-[11px] font-bold text-slate-500 uppercase">Threshold Kontras</label>
                        <label className="flex items-center gap-1 text-[11px] font-bold text-blue-600 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={useOtsu} 
                            onChange={(e) => setUseOtsu(e.target.checked)} 
                            className="rounded text-blue-600 focus:ring-0 focus:ring-offset-0"
                          />
                          Otomatis (Otsu)
                        </label>
                      </div>
                      
                      {useOtsu ? (
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-2.5 text-center text-xs text-slate-500">
                          Mendeteksi batas hitam-putih optimal untuk setiap gambar secara cerdas.
                        </div>
                      ) : (
                        <div className="space-y-1 bg-slate-50 rounded-xl p-2 border border-slate-100">
                          <input 
                            type="range" 
                            min="10" 
                            max="245" 
                            value={threshold} 
                            onChange={(e) => setThreshold(Number(e.target.value))}
                            className="w-full accent-blue-600 cursor-pointer h-1 bg-slate-200 rounded-lg appearance-none"
                          />
                          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                            <span>Sensitif (Terang)</span>
                            <span className="font-bold text-blue-600">Nilai: {threshold}</span>
                            <span>Gelap</span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Smoothing (RDP scale) */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1.5">
                        Tingkat Kelancaran Garis (Smoothing)
                      </label>
                      <div className="bg-slate-50 rounded-xl p-2 border border-slate-100 space-y-1">
                        <input 
                          type="range" 
                          min="0.2" 
                          max="2.5" 
                          step="0.1"
                          value={smoothing} 
                          onChange={(e) => setSmoothing(Number(e.target.value))}
                          className="w-full accent-blue-600 cursor-pointer h-1 bg-slate-200 rounded-lg appearance-none"
                        />
                        <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                          <span>Detail Tajam (0.2px)</span>
                          <span className="font-bold text-blue-600">{smoothing}px</span>
                          <span>Flawless (2.5px)</span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>

                {/* 2. Groq AI Keys */}
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-2 pb-1 border-b border-indigo-50">
                    <Key className="text-indigo-600 w-4 h-4" />
                    <h3 className="font-bold text-slate-800 text-sm">Sambungkan Groq API Key (Mewarnai &amp; Desain AI)</h3>
                  </div>
                  
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Fitur standard vectorisasi hitam-putih kami berjalan <strong>seratus persen gratis</strong> secara lokal di browser Anda.
                    Jika Anda ingin menghias, memberi warna gradasi futuristik, neon glow, atau 3D metal emas menggunakan AI, silakan isi Groq API Key Anda.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Groq API Key</label>
                      <div className="relative">
                        <input
                          type={showKey ? 'text' : 'password'}
                          value={groqKey}
                          onChange={(e) => setGroqKey(e.target.value)}
                          placeholder="gsk_..."
                          className="w-full pl-3 pr-10 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-500 font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey(!showKey)}
                          className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                        >
                          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Model Groq LLM</label>
                      <input
                        type="text"
                        value={groqModel}
                        onChange={(e) => setGroqModel(e.target.value)}
                        placeholder="meta-llama/llama-4-scout-17b-16e-instruct"
                        className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                    <span>API Key disimpan aman hanya di browser local storage Anda sendiri.</span>
                    <button 
                      onClick={() => {
                        setGroqKey('');
                        setGroqModel('meta-llama/llama-4-scout-17b-16e-instruct');
                      }}
                      className="text-red-500 hover:underline font-bold"
                    >
                      Reset Setelan Groq
                    </button>
                  </div>
                </div>

              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Drag n Drop Upload Area */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) {
              const newFiles = Array.from(e.dataTransfer.files).map((file: File) => ({
                id: Math.random().toString(36).substring(2, 9),
                name: file.name,
                status: 'pending' as const,
                fileObj: file
              }));
              setFiles(prev => [...prev, ...newFiles as any]);
            }
          }}
          className="border-2 border-dashed border-slate-300 bg-white rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-slate-50/50 transition-all duration-200 group shadow-xs"
        >
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple 
            accept="image/*"
            className="hidden"
          />
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-all shadow-xs">
            <Upload className="w-7 h-7" />
          </div>
          <span className="text-base font-bold text-slate-800 text-center">Klik / Tarik Banyak File Gambar di Sini sekaligus</span>
          <span className="text-xs text-slate-400 mt-1 dark:text-slate-500">Mendukung file PNG, JPG, JPEG, WEBP, BMP, TIFF</span>
        </div>

        {/* Dynamic Action Panel */}
        {files.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold bg-slate-100 text-slate-800 px-3 py-1.5 rounded-lg">
                {files.length} File Gambar Terpilih
              </span>
              <button 
                onClick={clearAll}
                className="text-xs text-red-500 hover:text-red-700 font-bold flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> Hapus Semua
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              {files.some(f => f.status === 'done') && (
                <button 
                  onClick={downloadAll}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-xs"
                >
                  <FolderDown className="w-4 h-4" /> Unduh ZIP Terkompres ({files.filter(f => f.status === 'done').length})
                </button>
              )}
              
              <button 
                onClick={processFiles}
                disabled={isUploading || !files.some(f => f.status === 'pending')}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xs"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sedang Konversi...
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    Mulai Konversi Vector
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Main Interface Content Split: List & AI Stylist Panel */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-6 pb-24">
          
          {/* File Lists */}
          <div className={`space-y-3 ${activeStylingFile ? 'lg:col-span-6' : 'lg:col-span-12'}`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider">Antrian &amp; Hasil Ekspor</h3>
              <span className="text-xs text-slate-400">Metode aktif: <strong className="text-blue-600 font-bold">{conversionMode === 'client' ? 'Browser Client' : 'Cloud Server'}</strong></span>
            </div>
            
            {files.length === 0 && (
              <div className="bg-slate-100/50 border border-slate-200 border-dashed rounded-xl p-10 text-center text-slate-400 text-sm">
                Belum ada berkas yang diunggah. Silakan tarik gambar Anda ke atas untuk memulai bulk conversion.
              </div>
            )}

            <AnimatePresence>
              {files.map((file) => (
                <motion.div 
                  key={file.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`bg-white border rounded-xl p-3.5 flex items-center justify-between group hover:shadow-md transition-all duration-200 ${
                    activeStylingFile?.id === file.id ? 'border-indigo-500 ring-2 ring-indigo-50' : 'border-slate-200'
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0 border border-slate-200/60 overflow-hidden">
                      {file.data ? (
                        <div 
                          className="w-full h-full p-1 flex items-center justify-center overflow-hidden [&>svg]:w-full [&>svg]:h-full"
                          dangerouslySetInnerHTML={{ __html: file.styledData || file.data }}
                        />
                      ) : (
                        <FileImage className="text-slate-400 w-5 h-5" />
                      )}
                    </div>
                    <div className="truncate">
                      <p className="font-semibold text-sm text-slate-800 truncate max-w-[180px] md:max-w-[320px]">
                        {file.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {file.status === 'pending' && (
                          <span className="text-[10px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded">
                            Siap dikonversi
                          </span>
                        )}
                        {file.status === 'processing' && (
                          <span className="text-[10px] bg-blue-50 text-blue-600 font-bold px-2 py-0.5 rounded flex items-center gap-1 animate-pulse">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Sedang berjalan...
                          </span>
                        )}
                        {file.status === 'done' && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> B&amp;W Vector Terbuat
                          </span>
                        )}
                        {file.styledData && (
                          <span className="text-[10px] bg-purple-50 text-purple-700 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                            <Sparkle className="w-2.5 h-2.5" /> Berwarna (AI)
                          </span>
                        )}
                        {file.status === 'error' && (
                          <span className="text-[10px] bg-red-50 text-red-600 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                            <XCircle className="w-2.5 h-2.5" /> Gagal ({file.error || 'Ekspor Gagal'})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Local B&W Download */}
                    {file.status === 'done' && file.data && (
                      <button 
                        onClick={() => downloadSingle(file, 'original')}
                        className="p-1.5 text-slate-500 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-1"
                        title="Unduh SVG Hitam-Putih"
                      >
                        <Download className="w-4 h-4" />
                        <span className="text-[10px] font-bold hidden sm:inline">B&amp;W</span>
                      </button>
                    )}

                    {/* AI Stylist Activation Button */}
                    {file.status === 'done' && file.data && (
                      <button 
                        onClick={() => {
                          setActiveStylingFile(file);
                          setStylingPrompt('');
                          setStylingError('');
                          if (!groqKey) {
                            setShowSettings(true);
                          }
                        }}
                        className={`p-1.5 rounded-lg transition-all flex items-center gap-1 text-xs font-bold ${
                          activeStylingFile?.id === file.id
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700'
                        }`}
                        title="Beri Warna / Gaya AI"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>AI Style</span>
                      </button>
                    )}

                    {file.status === 'pending' && (
                      <button 
                        onClick={() => removeFile(file.id)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* Interactive AI Stylist Sidebar */}
          <AnimatePresence>
            {activeStylingFile && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                className="lg:col-span-6 space-y-4"
              >
                <div className="bg-white border-2 border-indigo-200 rounded-2xl p-5 shadow-sm sticky top-6">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <Palette className="text-indigo-600 w-5 h-5 animate-pulse" />
                      <h4 className="font-extrabold text-slate-900">AI Vector Stylist &amp; Colorizer</h4>
                    </div>
                    <button 
                      onClick={() => setActiveStylingFile(null)}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Rendering SVG Comparison */}
                  <div className="grid grid-cols-2 gap-3 py-3 bg-slate-50 rounded-xl p-3 my-3">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-black text-slate-400 tracking-wider uppercase mb-1">
                        Hitam Putih (Lokal)
                      </span>
                      <div 
                        className="w-full h-32 bg-white rounded-lg border border-slate-200 p-2 flex items-center justify-center overflow-hidden [&>svg]:max-w-full [&>svg]:max-h-full"
                        dangerouslySetInnerHTML={{ __html: activeStylingFile.data || '' }}
                      />
                      <button
                        onClick={() => downloadSingle(activeStylingFile, 'original')}
                        className="mt-2 text-[10px] font-bold text-slate-600 hover:underline flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" /> Unduh B&amp;W
                      </button>
                    </div>

                    <div className="flex flex-col items-center border-l border-slate-200 pl-3">
                      <span className="text-[10px] font-black text-indigo-500 tracking-wider uppercase mb-1">
                        AI Styled (Groq)
                      </span>
                      {activeStylingFile.styledData ? (
                        <>
                          <div 
                            className="w-full h-32 bg-indigo-50/20 rounded-lg border border-indigo-200 p-2 flex items-center justify-center overflow-hidden [&>svg]:max-w-full [&>svg]:max-h-full"
                            dangerouslySetInnerHTML={{ __html: activeStylingFile.styledData }}
                          />
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              onClick={() => downloadSingle(activeStylingFile, 'styled')}
                              className="text-[10px] font-bold text-indigo-600 hover:underline flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" /> Unduh Hasil AI
                            </button>
                            <button
                              onClick={() => removeAIStyling(activeStylingFile.id)}
                              className="text-[10px] font-bold text-red-500 hover:underline"
                            >
                              Hapus
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="w-full h-32 bg-slate-100/60 rounded-lg border border-slate-200/50 flex flex-col items-center justify-center text-center p-3">
                          <Sparkles className="text-slate-300 w-8 h-8 mb-1" />
                          <span className="text-[10px] text-slate-400 leading-normal">
                            Belum diganti gaya.<br />Ketik instruksi di bawah!
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* AI styling prompt input */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 uppercase mb-1">
                      Instruksi Perubahan Gaya / Warna
                    </label>
                    <textarea
                      value={stylingPrompt}
                      onChange={(e) => setStylingPrompt(e.target.value)}
                      placeholder="Contoh: Jadikan garis warna emas logam mengkilap dengan bayangan hitam..."
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-500 bg-white"
                      rows={3}
                    />
                  </div>

                  {/* Suggestions list */}
                  <div className="mt-2">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wide block mb-1">
                      Palet &amp; Ide Cepat
                    </span>
                    <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
                      {styleSuggestions.map((s, idx) => (
                        <button
                          key={idx}
                          onClick={() => setStylingPrompt(s)}
                          className="text-[10px] text-left bg-indigo-50 hover:bg-indigo-100/80 text-indigo-700 font-medium px-2 py-1 rounded-md transition-all border border-indigo-100"
                        >
                          ✨ {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {stylingError && (
                    <div className="mt-3 p-2.5 bg-red-50 border border-red-100 text-red-600 text-xs rounded-xl flex items-start gap-2">
                      <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="font-semibold leading-normal">{stylingError}</span>
                    </div>
                  )}

                  {!groqKey && (
                    <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-medium leading-relaxed">
                      ⚠️ Harap isi API Key Groq Anda di Pengaturan (kanan atas) terlebih dahulu untuk membuka fitur pewarnaan AI ini secara langsung.
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div className="text-[10px] text-slate-400 font-mono">
                      Model: {groqModel.split('/').pop()}
                    </div>
                    
                    <button 
                      onClick={applyAIStyling}
                      disabled={isStyling || !groqKey}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all disabled:opacity-50 shadow-sm animate-pulse-subtle"
                    >
                      {isStyling ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Sedang Mendesain (Groq)...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Terapkan Warna AI
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

        </div>

      </div>
    </div>
  );
}
