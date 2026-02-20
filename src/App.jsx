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
    console.error("Erreur lors de l'injection du DPI:", error);
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
    
    const apiKey = "";

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${apiKey}`;
    
    try {
      let response;
      let retries = 0;
      const delays = [1000, 2000, 4000, 8000, 16000];

      while (retries < 5) {
        response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: { prompt: prompt + ", photorealistic, highly detailed" },
            parameters: { sampleCount: 1 }
          })
        });

        if (response.ok) break;
        await new Promise(r => setTimeout(r, delays[retries]));
        retries++;
      }

      if (!response.ok) throw new Error("Erreur lors de la génération de l'image.");

      const data = await response.json();
      const base64Image = `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`;
      setSourceImage(base64Image);
      setActiveTab('convert'); 

    } catch (err) {
      setError("Désolé, la génération a échoué. Veuillez vérifier votre clé API.");
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
        const outputHeight = 300;
        const offset = 40; 
        const outputWidth = outputHeight + offset; 
        
        canvas.width = outputWidth;
        canvas.height = outputHeight;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = '#E5E7EB';
        ctx.beginPath();
        ctx.arc(outputHeight / 2 + offset, outputHeight / 2, outputHeight / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.closePath();

        ctx.save();
        ctx.beginPath();
        ctx.arc(outputHeight / 2, outputHeight / 2, outputHeight / 2, 0, Math.PI * 2);
        ctx.clip(); 

        const imgRatio = img.width / img.height;
        const targetSize = outputHeight;
        let drawW = targetSize;
        let drawH = targetSize;
        let drawX = 0;
        let drawY = 0;

        if (imgRatio < 1) { 
          drawH = targetSize / imgRatio;
          drawY = (targetSize - drawH) / 2;
        } else { 
          drawW = targetSize * imgRatio;
          drawX = (targetSize - drawW) / 2;
        }

        ctx.drawImage(img, drawX, drawY, drawW, drawH);
        ctx.restore(); 

        const rawDataUrl = canvas.toDataURL('image/png');
        const finalDataUrlWithDpi = setDpiInPngBase64(rawDataUrl, 90);
        
        setProcessedImageUrl(finalDataUrlWithDpi);
      };
      img.src = sourceImage;
    } else {
      setProcessedImageUrl(null);
    }
  }, [sourceImage]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6 font-sans">
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row min-h-[500px]">
        
        <div className="w-full md:w-1/2 bg-gray-100 p-8 border-r border-gray-200 flex flex-col">
          <h1 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
            <ImageIcon className="text-indigo-600" />
            Studio Mock-up
          </h1>

          <div className="flex bg-gray-200 rounded-lg p-1 mb-8">
            <button
              onClick={() => setActiveTab('convert')}
              className={`flex-1 py-2 text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-colors ${activeTab === 'convert' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <UploadCloud size={16} /> Convertisseur
            </button>
            <button
              onClick={() => setActiveTab('generate')}
              className={`flex-1 py-2 text-sm font-medium rounded-md flex items-center justify-center gap-2 transition-colors ${activeTab === 'generate' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'}`}
            >
              <Wand2 size={16} /> Générateur
            </button>
          </div>

          {activeTab === 'convert' && (
            <div className="flex-1 flex flex-col justify-center">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:bg-gray-50 transition-colors flex flex-col items-center justify-center group"
              >
                <div className="bg-indigo-100 p-3 rounded-full mb-4 group-hover:scale-110 transition-transform">
                  <UploadCloud className="text-indigo-600" size={32} />
                </div>
                <p className="text-gray-700 font-medium mb-1">Cliquez pour importer une image</p>
                <p className="text-gray-400 text-sm">JPG, PNG (max 5MB)</p>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>
            </div>
          )}

          {activeTab === 'generate' && (
            <div className="flex-1 flex flex-col">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Thématique / Description de l'image
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ex: Une femme d'affaires souriante devant un tableau couvert de post-its colorés..."
                className="w-full h-32 p-3 border border-gray-300 rounded-xl mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
              <button
                onClick={handleGenerateImage}
                disabled={isGenerating || !prompt.trim()}
                className="w-full bg-indigo-600 text-white font-medium py-3 rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:bg-indigo-400 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Création en cours...
                  </>
                ) : (
                  <>
                    <Wand2 size={18} />
                    Générer l'illustration
                  </>
                )}
              </button>
              {error && <p className="text-red-500 text-sm mt-3 text-center">{error}</p>}
            </div>
          )}
        </div>

        <div className="w-full md:w-1/2 p-8 flex flex-col items-center justify-center bg-white">
          
          <div 
            className="mb-6 w-full max-w-[340px] aspect-[340/300] flex items-center justify-center bg-white border border-gray-200 rounded-xl relative overflow-hidden shadow-inner" 
            style={{ backgroundImage: 'radial-gradient(#d1d5db 1px, transparent 1px)', backgroundSize: '16px 16px' }}
          >
            {processedImageUrl ? (
              <img 
                src={processedImageUrl} 
                alt="Résultat mock-up" 
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="text-center p-6 bg-white/80 rounded-full">
                <ImageIcon className="text-gray-300 mx-auto mb-2" size={48} />
                <p className="text-gray-400 text-sm">L'aperçu apparaîtra ici</p>
              </div>
            )}
          </div>

          <div className="text-center mb-8">
            <h3 className="text-lg font-semibold text-gray-800">Résultat Final</h3>
            <p className="text-sm text-gray-500">Format : 340x300px • Résolution : 90 DPI</p>
          </div>

          <a
            href={processedImageUrl || '#'}
            download="mockup-illustration.png"
            className={`w-full max-w-[300px] py-3 px-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
              processedImageUrl 
                ? 'bg-green-600 hover:bg-green-700 text-white shadow-md hover:shadow-lg' 
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
            onClick={(e) => !processedImageUrl && e.preventDefault()}
          >
            <Download size={18} />
            Télécharger (.png)
          </a>

          <canvas ref={canvasRef} className="hidden" />

        </div>
      </div>
    </div>
  );
}
