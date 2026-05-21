import React, { useState, useRef } from 'react';
import { 
  Upload, 
  Trash2, 
  Download, 
  FileImage, 
  Loader2, 
  CheckCircle2, 
  XCircle,
  FolderDown,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import JSZip from 'jszip';

interface ProcessedFile {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  data?: string; // SVG content
  error?: string;
}

export default function App() {
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles: ProcessedFile[] = Array.from(e.target.files).map(file => ({
        id: Math.random().toString(36).substr(2, 9),
        name: (file as File).name,
        status: 'pending' as const,
        fileObj: file
      })) as any;
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const clearAll = () => {
    setFiles([]);
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
        // @ts-ignore
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
      setFiles(prev => prev.map(f => f.status === 'processing' ? { ...f, status: 'error', error: 'Server connection failed' } : f));
    } finally {
      setIsUploading(false);
    }
  };

  const downloadSingle = (file: ProcessedFile) => {
    if (!file.data) return;
    const blob = new Blob([file.data], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name.split('.')[0] + '.svg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadAll = async () => {
    const doneFiles = files.filter(f => f.status === 'done' && f.data);
    if (doneFiles.length === 0) return;

    const zip = new JSZip();
    doneFiles.forEach(f => {
      zip.file(f.name.split('.')[0] + '.svg', f.data!);
    });

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vectorized_images.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-10 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-2">VectorBulk</h1>
          <p className="text-slate-500 max-w-md mx-auto">
            Ubah banyak gambar sekaligus menjadi vector (SVG) hitam putih dengan satu klik.
          </p>
        </header>

        {/* Upload Zone */}
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-300 rounded-2xl p-12 bg-white flex flex-col items-center justify-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-all group"
        >
          <input 
            type="file" 
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple 
            accept="image/*"
            className="hidden"
          />
          <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <Upload className="text-blue-500 w-8 h-8" />
          </div>
          <p className="text-lg font-medium">Klik atau drop gambar di sini</p>
          <p className="text-sm text-slate-400 mt-1">Mendukung PNG, JPG, JPEG, BMP (Bulk Upload)</p>
        </div>

        {/* Note about output format */}
        <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            <strong>Catatan:</strong> Saat ini output dalam format <strong>SVG</strong> (Vector). Format EPS 10 biasanya memerlukan Ghostscript di server, namun SVG dapat langsung diimpor ke Illustrator/Corel dan disimpan sebagai EPS.
          </p>
        </div>

        {/* Action Bar */}
        {files.length > 0 && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-100">
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600">
                {files.length} File dipilih
              </span>
              <button 
                onClick={clearAll}
                className="text-sm text-red-500 hover:text-red-600 font-medium flex items-center gap-1 px-2 py-1 rounded hover:bg-red-50 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Hapus Semua
              </button>
            </div>
            
            <div className="flex items-center gap-3">
              {files.some(f => f.status === 'done') && (
                <button 
                  onClick={downloadAll}
                  className="bg-slate-800 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 hover:bg-slate-900 transition-colors shadow-sm"
                >
                  <FolderDown className="w-4 h-4" /> Download ZIP
                </button>
              )}
              
              <button 
                onClick={processFiles}
                disabled={isUploading || !files.some(f => f.status === 'pending')}
                className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-md shadow-blue-200"
              >
                {isUploading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Memproses...</>
                ) : (
                  'Mulai Konversi'
                )}
              </button>
            </div>
          </div>
        )}

        {/* File List */}
        <div className="mt-6 space-y-3 pb-20">
          <AnimatePresence>
            {files.map((file) => (
              <motion.div 
                key={file.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white border border-slate-100 p-4 rounded-xl flex items-center justify-between group hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4 overflow-hidden">
                  <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                    <FileImage className="text-slate-400 w-6 h-6" />
                  </div>
                  <div className="truncate">
                    <p className="font-medium text-slate-800 truncate max-w-[200px] md:max-w-md">{file.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {file.status === 'pending' && <span className="text-xs text-slate-400">Siap dikonversi</span>}
                      {file.status === 'processing' && <span className="text-xs text-blue-500 animate-pulse">Memproses...</span>}
                      {file.status === 'done' && <span className="text-xs text-emerald-500 font-medium">Selesai</span>}
                      {file.status === 'error' && <span className="text-xs text-red-500">{file.error || 'Error'}</span>}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {file.status === 'done' && (
                    <button 
                      onClick={() => downloadSingle(file)}
                      className="p-2 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Download Vector"
                    >
                      <Download className="w-5 h-5" />
                    </button>
                  )}
                  {file.status === 'pending' && (
                    <button 
                      onClick={() => removeFile(file.id)}
                      className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                  {file.status === 'done' && <CheckCircle2 className="text-emerald-500 w-5 h-5 ml-2" />}
                  {file.status === 'error' && <XCircle className="text-red-500 w-5 h-5 ml-2" />}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
