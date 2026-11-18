'use client';

import { useEffect, useRef } from 'react';

/**
 * Pilha do botão Voltar do controle (aplicativo de TV), no estilo Netflix: o Voltar fecha primeiro
 * o que estiver aberto por cima (seletor, menu do player, player em tela cheia) — sempre o mais
 * recente — e só depois volta de tela. Na Web nada usa a pilha; os componentes funcionam igual.
 */
type Handler = () => void;
const stack: Handler[] = [];

export function pushBack(handler: Handler): () => void {
  stack.push(handler);
  return () => {
    const index = stack.lastIndexOf(handler);
    if (index >= 0) stack.splice(index, 1);
  };
}

/** Executa a camada mais recente; `false` quando não há nada aberto. */
export function runBack(): boolean {
  const handler = stack[stack.length - 1];
  if (!handler) return false;
  handler();
  return true;
}

/** Registra [onBack] enquanto [active] for verdadeiro (ex.: enquanto o seletor estiver aberto). */
export function useBackLayer(active: boolean, onBack: () => void) {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    return pushBack(() => ref.current());
  }, [active]);
}
