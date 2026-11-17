import type { ParentalSettings } from '@tuitv/shared-models';
import { fromBase64, pbkdf2, randomBytes, toBase64 } from './crypto';
import { normalizeText } from './text';

const PIN_ITERATIONS = 120_000;
const ADULT_RE = /(^|[^a-z0-9])(adult[oa]?s?|xxx|porn[a-z]*|erotic[a-z]*)([^a-z0-9]|$)|\+ ?18|18 ?\+/;

export const isValidPin = (pin: string) => /^\d{4,8}$/.test(pin);

export async function hashPin(pin: string, salt?: string): Promise<{ pinHash: string; pinSalt: string }> {
  const saltBytes = salt ? fromBase64(salt) : randomBytes(16);
  const bits = await pbkdf2(pin, saltBytes, PIN_ITERATIONS, 256);
  return { pinHash: toBase64(bits), pinSalt: toBase64(saltBytes) };
}

export async function verifyPin(pin: string, settings: ParentalSettings): Promise<boolean> {
  if (!settings.pinHash || !settings.pinSalt) return false;
  const { pinHash } = await hashPin(pin, settings.pinSalt);
  if (pinHash.length !== settings.pinHash.length) return false;
  let diff = 0;
  for (let i = 0; i < pinHash.length; i++) diff |= pinHash.charCodeAt(i) ^ settings.pinHash.charCodeAt(i);
  return diff === 0;
}

/** A categoria/nome indica conteúdo adulto. */
export function isAdultLabel(label: string | undefined): boolean {
  return !!label && ADULT_RE.test(normalizeText(label));
}

/** Cria o filtro de bloqueio para a sessão atual. Retorna null quando nada é bloqueado. */
export function createRestriction(
  settings: ParentalSettings,
  unlocked: boolean,
): ((item: { group?: string; name: string }) => boolean) | null {
  if (!settings.enabled || unlocked) return null;
  const locked = new Set(settings.lockedGroups);
  const cache = new Map<string, boolean>();
  return (item) => {
    const group = item.group ?? '';
    let blocked = cache.get(group);
    if (blocked === undefined) {
      blocked = locked.has(normalizeText(group)) || (settings.hideAdult && isAdultLabel(group));
      cache.set(group, blocked);
    }
    return blocked || (settings.hideAdult && !group && isAdultLabel(item.name));
  };
}
