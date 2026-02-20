import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Wand2, Download, Loader2 } from 'lucide-react';

// Fonction utilitaire pour injecter la métadonnée 90 DPI (pHYs chunk) dans un PNG en Base64
const setDpiInPngBase64 = (base64Image, dpi) => {
  try {
    const data = atob(base64Image.split(',')[1]);
    const dataArray = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      dataArray[i] = data.charCodeAt(i);
    }

    if (dataArray[0] !== 137 || dataArray[1] !== 80 || dataArray[2] !== 78 || dataArray[3] !== 71) {
      return base64Image;
    }

    const ppm = Math.round(dpi / 0.0254);
    const physChunk = new Uint8Array(21);
    physChunk[3] = 9;
    physChunk[4] = 112; physChunk[5] = 72; physChunk[6] = 89; physChunk[7] = 115;
    
    physChunk[8] = (ppm >>> 24) & 255; physChunk[9] = (ppm >>> 16) & 255; physChunk[10] = (ppm >>> 8) & 255; physChunk[11] = ppm & 255;
    physChunk[12] = (ppm >>> 24) & 255; physChunk[13] = (ppm >>> 16) & 255; physChunk[14] = (ppm >>> 8) & 255; physChunk[15] = ppm & 255;
    physChunk[16] = 1;

    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c;
    }
    let crc = 0 ^ (-1);
    for (let i = 4; i < 17; i++) {
      crc = (crc >>> 8) ^ crcTable[(crc ^ physChunk[i]) & 0xFF];
    }
    crc = (crc ^ (-1)) >>> 0;
    physChunk[17] = (crc >>> 24) & 255; physChunk[18] = (crc >>> 16) & 255; physChunk[19] = (crc >>> 8) & 255; physChunk[20] = crc & 255;

    let offset = 8;
    while (offset < dataArray.length) {
      const length = (dataArray[offset] << 24) | (dataArray[offset + 1] << 16) | (dataArray[offset + 2] << 8) | dataArray[offset + 3];
      const type = String.fromCharCode(dataArray[offset + 4], dataArray[offset + 5], dataArray[offset + 6], dataArray[offset + 7]);
      if (type === 'IHDR') {
        offset += 12 + length;
        break;
      }
      offset += 12 + length;
    }

    const newDataArray = new Uint8Array(dataArray.length + 21);
    newDataArray.set(dataArray.subarray(0, offset), 0);
    newDataArray.set(physChunk, offset);
    newDataArray.set(dataArray.subarray(offset), offset + 21);

    let newBase64 = '';
    for (let i = 0; i < newDataArray.length; i++) {
      newBase64 += String.fromCharCode(newDataArray[i]);
    }
    return 'data:image/png;base64,' + btoa(newBase64);
  } catch (error) {
    console.error("Erreur injection DPI:", error);
    return base64Image;
  }
};

export default function App() {
  const [activeTab, setActiveTab] = useState('convert');
  const [sourceImage, setSourceImage] = useState(null);
  const [processedImageUrl, setProcessedImageUrl] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setSourceImage(event.target.result);
        setError('');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleGenerateImage = async () => {
    if (!prompt.trim()) {
      setError("Veuillez entrer une description.");
      return;
    }

    setIsGenerating(true);
    setError('');
    
    // Récupération de la clé API via Vite
    let apiKey = "";
    try {
      apiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
    } catch (e) {
      apiKey = "";
    }

    if (!apiKey) {
      setError("Clé API manquante dans l'environnement GitHub.");
      setIsGenerating(false);
      return;
    }

    // Le modèle peut être "imagen-3.0-generate-001" ou simplement "imagen-3.0"
    // Dans v1beta de AI Studio, imagen-3.0-generate-001 est le standard actuel.
    const model = "imagen-3.0-generate-001"; 
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
    
    try {
      let response;
      let retries = 0;
      const delays = [1000, 2000, 4000];

      while (retries < 3) {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Format corrigé : instances est un tableau pour l'endpoint :predict
            instances: [
              {
                prompt: prompt + ", photorealistic style, professional photography, centered composition, high resolution, white background"
              }
            ],
            parameters: {
              sampleCount: 1,
              aspectRatio: "1:1"
            }
          })
        });

        if (response.ok) break;
        
        const errorData = await response.json().catch(() => ({}));
        if (response.status === 404) throw new Error(`Modèle ${model} introuvable. Votre région ou clé ne supporte peut-être pas encore Imagen via API.`);
        if (response.status === 403) throw new Error("Accès refusé. Vérifiez vos quotas ou si Imagen est activé dans Google AI Studio.");
        
        await new Promise(r => setTimeout(r, delays[retries]));
        retries++;
      }

      if (!response.ok) {
        const finalError = await response.json().catch(() => ({}));
        throw new Error(finalError.error?.message || "Échec de la génération.");
      }

      const data = await response.json();
      
      if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
        const base64Image = `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
        setSourceImage(base64Image);
        setActiveTab('convert'); 
      } else {
        throw new Error("L'API a répondu mais n'a pas renvoyé d'image (vérifiez les filtres de sécurité).");
      }

    } catch (err) {
      setError(err.message);
      console.error("Détails de l'erreur API:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (sourceImage && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      img.onload = () => {
        const h = 300;
        const off = 40; 
        const w = h + off; 
        
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        // Cercle gris décalé
        ctx.fillStyle = '#E5E7EB';
        ctx.beginPath();
        ctx.arc(h/2 + off, h/2, h/2, 0, Math.PI * 2);
        ctx.fill();

        // Image avec masque
        ctx.save();
        ctx.beginPath();
        ctx.arc(h/2, h/2, h/2, 0, Math.PI * 2);
        ctx.clip(); 

        const ratio = img.width / img.height;
        let dW = h, dH = h, dX = 0, dY = 0;
        if (ratio < 1) { dH = h / ratio; dY = (h - dH) / 2; }
        else { dW = h * ratio; dX = (h - dW) / 2; }

        ctx.drawImage(img, dX, dY, dW, dH);
        ctx.restore(); 

        const raw = canvas.toDataURL('image/png');
        setProcessedImageUrl(setDpiInPngBase64(raw, 90));
      };
      img.src = sourceImage;
    }
  }, [sourceImage]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
      <div className="max-w-4xl w-full bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-slate-100">
        
        <div className="w-full md:w-1/2 bg-slate-50/50 p-8 flex flex-col border-b md:border-b-0 md:border-r border-slate-200">
          <header className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-indigo-600 rounded-lg shadow-lg">
                <ImageIcon className="text-white" size={24} />
              </div>
              <h1 className="text-xl font-bold tracking-tight">Studio Mock-up</h1>
            </div>
            <p className="text-slate-500 text-sm">Convertisseur & Générateur d'illustrations.</p>
          </header>

          <div className="flex bg-slate-200/50 p-1 rounded-xl mb-8">
            <button
              onClick={() => setActiveTab('convert')}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'convert' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-600 hover:text-slate-800'}`}
            >
              <UploadCloud size={18} /> Import
            </button>
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex-1 py-2.5 text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all ${activeTab === 'generate' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-600 hover:text-slate-800'}`}
            >
              <Wand2 size={18} /> IA
            </button>
          </div>

          <div className="flex-1 flex flex-col min-h-[300px]">
            {activeTab === 'convert' ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/30 transition-all flex flex-col items-center justify-center group"
              >
                <UploadCloud className="text-slate-400 group-hover:text-indigo-500 mb-4 transition-colors" size={48} />
                <p className="text-slate-700 font-semibold">Cliquer pour importer</p>
                <p className="text-slate-400 text-xs mt-1">PNG, JPG jusqu'à 5MB</p>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
              </div>
            ) : (
              <div className="space-y-4">
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ex: Une équipe travaillant dans un bureau moderne avec des post-its..."
                  className="w-full h-40 p-4 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none text-sm bg-white"
                />
                <button
                  onClick={handleGenerateImage}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full bg-indigo-600 text-white font-bold py-4 rounded-2xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-3 disabled:bg-slate-300 shadow-lg shadow-indigo-100"
                >
                  {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Wand2 size={20} />}
                  Générer l'illustration
                </button>
              </div>
            )}
            
            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl">
                <p className="text-red-600 text-[11px] font-medium leading-relaxed italic">{error}</p>
              </div>
            )}
          </div>
        </div>

        <div className="w-full md:w-1/2 p-8 flex flex-col items-center justify-center">
          <div 
            className="mb-8 w-full max-w-[340px] aspect-[340/300] flex items-center justify-center bg-slate-50 border border-slate-100 rounded-3xl relative overflow-hidden" 
            style={{ backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', backgroundSize: '20px 20px' }}
          >
            {processedImageUrl ? (
              <img src={processedImageUrl} alt="Preview" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center opacity-20">
                <ImageIcon className="mx-auto mb-2" size={64} />
                <p className="text-sm font-medium">Votre visuel ici</p>
              </div>
            )}
          </div>

          <div className="w-full max-w-[300px] space-y-6">
            <div className="text-center">
              <span className="inline-block px-3 py-1 bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase rounded-full mb-2 tracking-tighter">Fichier finalisé</span>
              <p className="text-[11px] text-slate-400">340x300px • 90 DPI • PNG Transparent</p>
            </div>

            <a
              href={processedImageUrl || '#'}
              download="mockup-illustration.png"
              className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all ${
                processedImageUrl 
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg' 
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
              onClick={(e) => !processedImageUrl && e.preventDefault()}
            >
              <Download size={20} /> Télécharger
            </a>
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>
      </div>
    </div>
  );
}
