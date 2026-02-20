import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, Image as ImageIcon, Wand2, Download, Loader2, Zap } from 'lucide-react';

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

  /**
   * Utilisation de Pollinations.ai
   * Avantages : Gratuit, pas de clé API, très rapide pour les tests.
   */
  const handleGenerateImage = async () => {
    if (!prompt.trim()) {
      setError("Veuillez entrer une description.");
      return;
    }

    setIsGenerating(true);
    setError('');
    
    try {
      // Construction de l'URL de génération (Pollinations accepte les paramètres en URL)
      const encodedPrompt = encodeURIComponent(prompt + ", professional photography, high resolution, centered, clean background");
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;

      // On vérifie que l'image est bien générée en essayant de la charger
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error("Le service de génération est temporairement indisponible.");

      // On convertit en Blob puis en Base64 pour rester compatible avec notre pipeline de DPI
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        setSourceImage(reader.result);
        setActiveTab('convert');
        setIsGenerating(false);
      };
      reader.readAsDataURL(blob);

    } catch (err) {
      setError("Désolé, la génération a échoué. Réessayez dans quelques instants.");
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (sourceImage && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = "anonymous"; // Crucial pour les images provenant d'une URL externe
      
      img.onload = () => {
        const h = 300;
        const off = 40; 
        const w = h + off; 
        
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        // Cercle gris décalé
        ctx.fillStyle = '#F3F4F6';
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
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4 font-sans text-slate-900">
      <div className="max-w-4xl w-full bg-white rounded-[2rem] shadow-2xl shadow-slate-200/50 overflow-hidden flex flex-col md:flex-row border border-slate-100">
        
        {/* Panneau Gauche */}
        <div className="w-full md:w-1/2 bg-slate-50/50 p-8 flex flex-col border-b md:border-b-0 md:border-r border-slate-100">
          <header className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-indigo-600 rounded-2xl shadow-lg shadow-indigo-100">
                <ImageIcon className="text-white" size={22} />
              </div>
              <h1 className="text-xl font-extrabold tracking-tight text-slate-800">Studio Mock-up</h1>
            </div>
            <p className="text-slate-400 text-xs font-medium uppercase tracking-widest">Illustration Designer v2</p>
          </header>

          <div className="flex bg-slate-200/50 p-1 rounded-2xl mb-8">
            <button
              onClick={() => setActiveTab('convert')}
              className={`flex-1 py-3 text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${activeTab === 'convert' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <UploadCloud size={18} /> Import
            </button>
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex-1 py-3 text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all ${activeTab === 'generate' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-600 hover:text-slate-700'}`}
            >
              <Zap size={18} /> IA Libre
            </button>
          </div>

          <div className="flex-1 flex flex-col min-h-[300px]">
            {activeTab === 'convert' ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 border-2 border-dashed border-slate-200 rounded-[1.5rem] p-8 text-center cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-all flex flex-col items-center justify-center group"
              >
                <div className="w-16 h-16 bg-white rounded-2xl shadow-sm border border-slate-100 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <UploadCloud className="text-indigo-500" size={32} />
                </div>
                <p className="text-slate-700 font-bold">Importer un fichier</p>
                <p className="text-slate-400 text-xs mt-2">Glissez votre image ici</p>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl mb-2">
                  <p className="text-[10px] text-amber-700 font-bold leading-tight">
                    MODE LIBRE : Ce moteur ne nécessite aucune clé API et est disponible immédiatement.
                  </p>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ex: Un bureau minimaliste avec des plantes et un café..."
                  className="w-full h-40 p-5 border border-slate-200 rounded-[1.5rem] focus:ring-4 focus:ring-indigo-50 focus:border-indigo-400 outline-none resize-none text-sm bg-white shadow-inner transition-all"
                />
                <button
                  onClick={handleGenerateImage}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full bg-slate-900 text-white font-bold py-4 rounded-[1.2rem] hover:bg-indigo-600 transition-all flex items-center justify-center gap-3 disabled:bg-slate-200 shadow-xl shadow-slate-200"
                >
                  {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
                  Générer maintenant
                </button>
              </div>
            )}
            
            {error && (
              <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-2xl">
                <p className="text-red-600 text-[11px] font-bold italic">{error}</p>
              </div>
            )}
          </div>
        </div>

        {/* Panneau Droit (Rendu) */}
        <div className="w-full md:w-1/2 p-10 flex flex-col items-center justify-center relative bg-white">
          <div 
            className="mb-10 w-full max-w-[340px] aspect-[340/300] flex items-center justify-center bg-slate-50 border border-slate-100 rounded-[2rem] relative overflow-hidden shadow-inner" 
            style={{ backgroundImage: 'radial-gradient(#e2e8f0 1.5px, transparent 1.5px)', backgroundSize: '24px 24px' }}
          >
            {processedImageUrl ? (
              <img src={processedImageUrl} alt="Preview" className="w-full h-full object-contain animate-in fade-in zoom-in duration-500" />
            ) : (
              <div className="text-center opacity-20">
                <ImageIcon className="mx-auto mb-3" size={64} />
                <p className="text-sm font-bold uppercase tracking-widest">En attente</p>
              </div>
            )}
          </div>

          <div className="w-full max-w-[280px] space-y-6">
            <div className="text-center">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase rounded-full mb-3 tracking-tighter border border-emerald-100">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Format Prêt
              </div>
              <p className="text-[11px] text-slate-400 font-medium">340x300px • 90 DPI • PNG Alpha</p>
            </div>

            <a
              href={processedImageUrl || '#'}
              download="mockup-studio-export.png"
              className={`w-full py-4 rounded-2xl font-black text-sm flex items-center justify-center gap-3 transition-all ${
                processedImageUrl 
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-200' 
                  : 'bg-slate-100 text-slate-300 cursor-not-allowed'
              }`}
              onClick={(e) => !processedImageUrl && e.preventDefault()}
            >
              <Download size={18} /> TÉLÉCHARGER
            </a>
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>
      </div>
    </div>
  );
}
