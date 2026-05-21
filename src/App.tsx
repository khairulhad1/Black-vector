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
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';

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

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      console.error('Error processing files:', error);
      setFiles(prev => prev.map(f => f.status === 'processing' ? { ...f, status: 'error', error: 'Sambungan server gagal' } : f));
    } finally {
      setIsUploading(false);
    }
  };

  // Perform Groq AI styling on a specific file
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
      const response = await fetch('/api/groq-stylist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Groq-API-Key': groqKey,
        },
        body: JSON.stringify({
          svg: activeStylingFile.data,
          prompt: stylingPrompt,
          model: groqModel
        })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Gagal memproses AI styling.');
      }

      const updatedFile: ProcessedFile = {
        ...activeStylingFile,
        styledData: result.svg,
        styledPrompt: stylingPrompt
      };

      // Sync updated file back to list
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
      // If there's an AI styled vector, download it. Otherwise download the black and white.
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
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-blue-600 text-white text-xs font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">BULK APP</span>
              <span className="text-slate-400 font-mono text-xs">Vitesse Offline &amp; Groq AI</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black tracking-tight text-slate-900">VectorBulk Studio</h1>
            <p className="text-slate-500 text-sm md:text-base mt-0.5">
              Konversi gambar ke vector hitam-putih seketika secara lokal, lalu hias dengan AI Groq pilihanmu!
            </p>
          </div>

          {/* Quick Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${
                showSettings 
                  ? 'bg-blue-50 border-blue-200 text-blue-700 shadow-sm' 
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Settings className="w-4 h-4" />
              Pengaturan Groq {groqKey ? '✅' : ''}
            </button>
          </div>
        </header>

        {/* Collapsible Groq Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-6"
            >
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-indigo-50">
                  <Key className="text-indigo-600 w-5 h-5" />
                  <h3 className="font-bold text-slate-800">Sambungkan Groq API Key</h3>
                </div>
                
                <p className="text-xs text-slate-500 leading-relaxed">
                  Konversi vector standar hitam-putih potrace <strong>100% gratis</strong> dan berjalan langsung di server lokal Anda. 
                  Jika Anda ingin memberi warna cerah, gradasi metallic, atau efek desain modern menggunakan AI, silakan input Groq API Key di bawah ini.
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
                        className="w-full pl-3 pr-10 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-500 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
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
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl focus:outline-none focus:border-indigo-500 font-mono"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                  <span>API Key disimpan secara aman di browser lokal Anda (localStorage).</span>
                  <button 
                    onClick={() => {
                      setGroqKey('');
                      setGroqModel('meta-llama/llama-4-scout-17b-16e-instruct');
                    }}
                    className="text-red-500 hover:underline"
                  >
                    Reset Setelan
                  </button>
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
          className="border-2 border-dashed border-slate-300 bg-white rounded-2xl p-10 flex flex-col items-center justify-center cursor-pointer hover:border-blue-500 hover:bg-slate-50/50 transition-all duration-200 group"
        >
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple 
            accept="image/*"
            className="hidden"
          />
          <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-all">
            <Upload className="w-7 h-7" />
          </div>
          <span className="text-base font-bold text-slate-800">Klik / Tarik Banyak File Gambar di Sini</span>
          <span className="text-xs text-slate-400 mt-1">Mendukung file PNG, JPG, JPEG, WEBP, BMP, TIFF</span>
        </div>

        {/* Info Box */}
        <div className="mt-4 p-3 bg-blue-50/50 border border-blue-100 rounded-xl flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-xs text-blue-900 leading-relaxed">
            <strong>Keunggulan Lokal:</strong> File Anda diproses seketika menggunakan compiler vector berkekuatan tinggi (Potrace &amp; Sharp) yang menghasilkan SVG tajam tanpa penurunan pixel! Output SVG sangat fleksibel dan dapat diekspor langsung di Adobe Illustrator, CorelDraw, Figma, atau Inkscape.
          </p>
        </div>

        {/* Dynamic Action Panel */}
        {files.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold bg-slate-100 text-slate-800 px-3 py-1 rounded-lg">
                {files.length} File
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
                  className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-4 py-2 rounded-xl flex items-center gap-2 transition-all shadow-sm"
                >
                  <FolderDown className="w-4 h-4" /> Unduh Format ZIP ({files.filter(f => f.status === 'done').length})
                </button>
              )}
              
              <button 
                onClick={processFiles}
                disabled={isUploading || !files.some(f => f.status === 'pending')}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-5 py-2 rounded-xl flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Memproses...
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
            <h3 className="text-xs font-black text-slate-500 uppercase tracking-wider mb-2">Daftar Gambar</h3>
            
            {files.length === 0 && (
              <div className="bg-slate-100/50 border border-slate-200 border-dashed rounded-xl p-10 text-center text-slate-400 text-sm">
                Belum ada berkas yang diunggah. Silakan klik area di atas untuk memulai.
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
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0 border border-slate-200/60">
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
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Sedang vectorisasi...
                          </span>
                        )}
                        {file.status === 'done' && (
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> B&amp;W Vector Siap
                          </span>
                        )}
                        {file.styledData && (
                          <span className="text-[10px] bg-purple-50 text-purple-700 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                            <Sparkles className="w-2.5 h-2.5" /> AI Styled
                          </span>
                        )}
                        {file.status === 'error' && (
                          <span className="text-[10px] bg-red-50 text-red-600 font-bold px-2 py-0.5 rounded flex items-center gap-1">
                            <XCircle className="w-2.5 h-2.5" /> Gagal ({file.error || 'Err'})
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
                          // Automatically open settings if key is missing
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
                        <span>Gaya AI</span>
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
                      placeholder="Contoh: Jadikan garis warna ungu dengan fill gradasi biru ke cyan..."
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
                    <div className="mt-3 p-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-medium">
                      ⚠️ Harap isi API Key Groq Anda di Pengaturan (kanan atas) terlebih dahulu untuk membuka fitur ini.
                    </div>
                  )}

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                    <div className="text-[10px] text-slate-400 font-mono">
                      Model: {groqModel.split('/').pop()}
                    </div>
                    
                    <button 
                      onClick={applyAIStyling}
                      disabled={isStyling || !groqKey}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 transition-all disabled:opacity-50 shadow-sm"
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
