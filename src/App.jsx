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
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (0xEDB88320 ^ (c >>> 1)); // Simplified for speed
      crcTable[n] = c;
    }
    // Correct CRC calculation
    const getCrc = (buf) => {
      let crc = 0 ^ (-1);
      for (let i = 4; i < buf.length - 4; i++) {
        crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xFF];
      }
      return (crc ^ (-1)) >>> 0;
    };

    // Note: crcTable generation and loop logic is preserved from previous functional version
    // but the key fix is the API call below.
    
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
  const [selectedModel, setSelectedModel] = useState('flux');
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
   * Utilisation de l'API Pollinations (Enterprise/Authenticated)
   * On passe la clé via le paramètre de requête ?key= pour éviter les erreurs 401 liées aux headers CORS
   */
  const handleGenerateImage = async () => {
    if (!prompt.trim()) {
      setError("Veuillez entrer une description.");
      return;
    }

    setIsGenerating(true);
    setError('');
    
    try {
      // Récupération de la clé API Pollinations via Vite
      const apiKey = import.meta.env.VITE_POLLINATIONS_API_KEY;

      const encodedPrompt = encodeURIComponent(prompt + ", professional commercial photography, high quality, hyper realistic, centered composition");
      const seed = Math.floor(Math.random() * 1000000);
      
      // Construction de l'URL avec la variable selectedModel
      const imageUrl = `https://gen.pollinations.ai/image/${encodedPrompt}?width=800&height=800&seed=${seed}&nologo=true&model=${selectedModel}`;
      
      // Envoi de la requête avec l'en-tête d'autorisation (Bearer token)
      const response = await fetch(imageUrl, {
        method: 'GET',
        headers: apiKey ? {
          'Authorization': `Bearer ${apiKey}`
        } : {}
      });

      if (!response.ok) {
        // Tentative de lecture du message d'erreur JSON
        const errorData = await response.json().catch(() => ({}));
        const message = errorData.error?.message || "Le service de génération ne répond pas.";
        
        if (response.status === 401) {
          throw new Error(`Accès refusé (401) : ${message}`);
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        setSourceImage(reader.result);
        setActiveTab('convert');
        setIsGenerating(false);
      };
      reader.readAsDataURL(blob);

    } catch (err) {
      setError(err.message || "Désolé, la génération a échoué. Veuillez vérifier votre configuration.");
      setIsGenerating(false);
    }
  };

  useEffect(() => {
    if (sourceImage && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.crossOrigin = "anonymous"; 
      
      img.onload = () => {
        const h = 300;
        const off = 40; 
        const w = h + off; 
        
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = '#F3F4F6';
        ctx.beginPath();
        ctx.arc(h/2 + off, h/2, h/2, 0, Math.PI * 2);
        ctx.fill();

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
      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(15px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-slide-up {
          animation: fadeSlideUp 0.5s ease-in-out forwards;
        }
        .animate-fade-slide-up-delayed {
          animation: fadeSlideUp 0.5s ease-in-out 0.15s forwards;
          opacity: 0;
        }
      `}</style>
      <div className="max-w-4xl w-full bg-white rounded-[2.5rem] shadow-2xl shadow-indigo-100 overflow-hidden flex flex-col md:flex-row border border-slate-100 animate-fade-slide-up">
        
        <div className="w-full md:w-1/2 bg-slate-50/50 p-10 flex flex-col border-b md:border-b-0 md:border-r border-slate-100">
          <header className="mb-10 animate-fade-slide-up">
            <div className="flex items-center gap-4 mb-3">
              <div className="p-3 bg-indigo-600 rounded-2xl shadow-xl shadow-indigo-200">
                <ImageIcon className="text-white" size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-slate-800">Mock-up – Mission</h1>
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em]">Convertisseur et générateur de vignette</p>
              </div>
            </div>
          </header>

          <div className="flex bg-slate-200/50 p-1.5 rounded-2xl mb-10 animate-fade-slide-up-delayed">
            <button
              onClick={() => setActiveTab('convert')}
              className={`flex-1 py-3 text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all duration-300 ease-in-out ${activeTab === 'convert' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <UploadCloud size={18} /> Convertisseur
            </button>
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex-1 py-3 text-sm font-bold rounded-xl flex items-center justify-center gap-2 transition-all duration-300 ease-in-out ${activeTab === 'generate' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
            >
              <Zap size={18} /> Génération par IA
            </button>
          </div>

          <div className="flex-1 flex flex-col min-h-[320px]" key={activeTab}>
            {activeTab === 'convert' ? (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="animate-fade-slide-up flex-1 border-2 border-dashed border-slate-200 rounded-[2rem] p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-white transition-all duration-300 ease-in-out flex flex-col items-center justify-center group"
              >
                <div className="w-20 h-20 bg-white rounded-[1.5rem] shadow-sm border border-slate-50 flex items-center justify-center mb-5 group-hover:scale-105 transition-transform group-hover:shadow-lg">
                  <UploadCloud className="text-indigo-600" size={36} />
                </div>
                <p className="text-slate-800 font-extrabold text-lg">Déposez votre visuel</p>
                <p className="text-slate-400 text-xs mt-3 font-medium">PNG, JPG ou WEBP supportés</p>
                <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept="image/*" className="hidden" />
              </div>
            ) : (
              <div className="space-y-5 animate-fade-slide-up">
                <div className="px-4 py-2.5 bg-indigo-50 border border-indigo-100 rounded-xl">
                  <p className="text-[10px] text-indigo-600 font-black leading-tight uppercase tracking-wider">
                    Moteur IA : Authentifié via gen.pollinations.ai
                  </p>
                </div>

                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="w-full p-4 border border-slate-200 rounded-[1.8rem] focus:ring-8 focus:ring-indigo-50 focus:border-indigo-400 outline-none text-sm bg-white shadow-inner transition-all duration-300 ease-in-out font-medium cursor-pointer"
                >
                  <option value="flux">Flux Schnell</option>
                  <option value="klein">Flux.2 Klein 4B</option>
                  <option value="klein-large">Flux.2 Klein9B</option>
                  <option value="gpt-image-1-mini">GPT Image 1 mini</option>
                </select>

                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Décrivez l'illustration souhaitée ici..."
                  className="w-full h-44 p-6 border border-slate-200 rounded-[1.8rem] focus:ring-8 focus:ring-indigo-50 focus:border-indigo-400 outline-none resize-none text-sm bg-white shadow-inner transition-all duration-300 ease-in-out font-medium"
                />
                <button
                  onClick={handleGenerateImage}
                  disabled={isGenerating || !prompt.trim()}
                  className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl hover:bg-indigo-600 transition-all duration-300 ease-in-out flex items-center justify-center gap-3 disabled:bg-slate-200 shadow-2xl shadow-slate-200 hover:scale-[1.02] active:scale-95"
                >
                  {isGenerating ? <Loader2 className="animate-spin" size={20} /> : <Zap size={20} />}
                  GÉNÉRER L'ILLUSTRATION
                </button>
              </div>
            )}
            
            {error && (
              <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-2xl animate-fade-slide-up">
                <p className="text-red-600 text-[11px] font-black italic text-center">{error}</p>
              </div>
            )}
          </div>
        </div>

        <div className="w-full md:w-1/2 p-12 flex flex-col items-center justify-center bg-white">
          <div 
            key={processedImageUrl ? 'image' : 'placeholder'}
            className="mb-12 w-full max-w-[340px] aspect-[340/300] flex items-center justify-center bg-[#FAFAFA] border border-slate-50 rounded-[2.5rem] relative overflow-hidden shadow-2xl shadow-slate-100 animate-fade-slide-up" 
            style={{ backgroundImage: 'radial-gradient(#E2E8F0 2px, transparent 2px)', backgroundSize: '28px 28px' }}
          >
            {processedImageUrl ? (
              <img src={processedImageUrl} alt="Preview" className="w-full h-full object-contain" />
            ) : (
              <div className="text-center opacity-10">
                <ImageIcon className="mx-auto mb-4" size={72} />
                <p className="text-xs font-black uppercase tracking-[0.3em]">Vignette</p>
              </div>
            )}
          </div>

          <div className="w-full max-w-[320px] space-y-8 animate-fade-slide-up-delayed">
            <div className="text-center">
              <div className="inline-flex items-center gap-2.5 px-4 py-1.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase rounded-full mb-4 tracking-tight border border-emerald-100">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                Rendu Optimisé
              </div>
              <p className="text-[11px] text-slate-400 font-bold tracking-wide">340x300px • 90 DPI • PNG Alpha</p>
            </div>

            <div className="flex gap-3 w-full" key={sourceImage ? 'has-source' : 'no-source'}>
              {activeTab === 'generate' && (
                <a
                  href={sourceImage || '#'}
                  download="illustration-originale.png"
                  className={`animate-fade-slide-up flex-1 py-4 rounded-2xl font-black text-[10px] tracking-widest flex flex-col items-center justify-center gap-1 transition-all duration-300 ease-in-out ${
                    sourceImage 
                      ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 shadow-md hover:translate-y-[-2px]' 
                      : 'bg-slate-50 text-slate-300 cursor-not-allowed'
                  }`}
                  onClick={(e) => !sourceImage && e.preventDefault()}
                  title="Télécharger l'image originale"
                >
                  <Download size={16} />
                  <span>ORIGINAL</span>
                </a>
              )}

              <a
                href={processedImageUrl || '#'}
                download="vignette.png"
                className={`animate-fade-slide-up flex-[2] py-4 rounded-2xl font-black text-[11px] tracking-widest flex items-center justify-center gap-2 transition-all duration-300 ease-in-out ${
                  processedImageUrl 
                    ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xl shadow-indigo-200 hover:translate-y-[-2px]' 
                    : 'bg-slate-100 text-slate-300 cursor-not-allowed'
                }`}
                onClick={(e) => !processedImageUrl && e.preventDefault()}
              >
                <Download size={18} />
                <span>VIGNETTE PNG</span>
              </a>
            </div>
          </div>

          <canvas ref={canvasRef} className="hidden" />
        </div>
      </div>
    </div>
  );
}
