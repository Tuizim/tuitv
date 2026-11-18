/** Aplicativo de TV (Tizen): mesma interface, com ajustes para o controle remoto. */
export const isTv = (): boolean => typeof document !== 'undefined' && document.documentElement.dataset.platform === 'tizen';
