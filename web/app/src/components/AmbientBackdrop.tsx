'use client';

import { useEffect, useRef, useState } from 'react';

/** Resolução do desenho: pequena de propósito — esticada para a tela, vira um desfoque suave. */
const W = 32;
const H = 18;

/**
 * Fundo "ambiente" a partir da capa (estilo Netflix/Apple TV): a imagem preenche a tela inteira,
 * bem desfocada e escurecida, sem as falhas de uma capa vertical recortada e ampliada.
 *
 * Desempenho: em vez de `filter: blur()` (caro para a GPU das TVs), a capa é desenhada num canvas
 * de 32×18 e o navegador apenas o amplia — a interpolação já produz o desfoque, num único desenho.
 * As camadas escuras por cima garantem a leitura do texto.
 */
export function AmbientBackdrop({ src }: { src?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    if (!src) return;
    let alive = true;
    const image = new Image();
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    image.onload = () => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!alive || !canvas || !context || !image.naturalWidth) return;
      // Recorte "cover" do centro da capa para a proporção da tela.
      const scale = Math.max(W / image.naturalWidth, H / image.naturalHeight);
      const sw = W / scale;
      const sh = H / scale;
      context.imageSmoothingEnabled = true;
      context.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, W, H);
      setReady(true);
    };
    image.src = src;
    return () => {
      alive = false;
      image.onload = null;
    };
  }, [src]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-bg" aria-hidden data-testid="ambient-backdrop">
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="absolute inset-0 size-full transition-opacity duration-500"
        style={{ opacity: ready ? 0.9 : 0 }}
      />
      {/* Leitura: véu geral + mais escuro à esquerda (onde fica o texto) e na base. */}
      <div className="absolute inset-0 bg-bg/45" />
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/75 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-bg via-transparent to-bg/50" />
    </div>
  );
}
