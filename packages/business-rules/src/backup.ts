import {
  BACKUP_APP_ID,
  BACKUP_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  type BackupData,
  type BackupEnvelope,
} from '@tuitv/shared-models';
import { hasCredentials, validateBackupData } from '@tuitv/validation';
import { cryptoAvailable, fromBase64, pbkdf2, randomBytes, toBase64 } from './crypto';

export const BACKUP_KDF_ITERATIONS = 210_000;

export class BackupError extends Error {
  constructor(public readonly code: 'password-required' | 'wrong-password' | 'invalid' | 'crypto-unavailable') {
    super(code);
  }
}

/** O backup contém endereços com credenciais/tokens (exige senha ou consentimento explícito). */
export function backupHasCredentials(data: BackupData): boolean {
  for (const { playlist, items } of data.playlists) {
    if (playlist.url && hasCredentials(playlist.url)) return true;
    if (items) {
      // Amostra: listas de um mesmo provedor repetem o padrão de endereço.
      const step = Math.max(1, Math.floor(items.length / 200));
      for (let i = 0; i < items.length; i += step) {
        if (hasCredentials(items[i]!.url)) return true;
      }
    }
  }
  return data.epgSources.some((s) => s.url && hasCredentials(s.url));
}

async function aesKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const bits = await pbkdf2(password, salt, iterations, 256);
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export interface BackupOptions {
  platform: BackupEnvelope['platform'];
  password?: string;
  now?: number;
}

/** Gera o conteúdo do arquivo de backup (JSON). Com senha, os dados são cifrados com AES-256-GCM. */
export async function createBackup(data: BackupData, options: BackupOptions): Promise<string> {
  const envelope: BackupEnvelope = {
    app: BACKUP_APP_ID,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    createdAt: options.now ?? Date.now(),
    platform: options.platform,
    encrypted: false,
  };
  // O PIN do controle parental pertence ao dispositivo e não é exportado.
  const portable: BackupData = {
    ...data,
    settings: { ...data.settings, parental: { ...data.settings.parental, enabled: false, pinHash: undefined, pinSalt: undefined } },
  };
  if (!options.password) {
    envelope.data = portable;
    return JSON.stringify(envelope);
  }
  if (!cryptoAvailable()) throw new BackupError('crypto-unavailable');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await aesKey(options.password, salt, BACKUP_KDF_ITERATIONS);
  const plain = new TextEncoder().encode(JSON.stringify(portable));
  const payload = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  envelope.encrypted = true;
  envelope.cipher = {
    kdf: 'PBKDF2-SHA256',
    iterations: BACKUP_KDF_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    payload: toBase64(payload),
  };
  return JSON.stringify(envelope);
}

/** Abre um envelope já validado por `validateBackupEnvelope`. */
export async function openBackup(envelope: BackupEnvelope, password?: string): Promise<BackupData> {
  let data: unknown;
  if (envelope.encrypted) {
    if (!password) throw new BackupError('password-required');
    if (!cryptoAvailable()) throw new BackupError('crypto-unavailable');
    const cipher = envelope.cipher!;
    const key = await aesKey(password, fromBase64(cipher.salt), cipher.iterations);
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(cipher.iv) }, key, fromBase64(cipher.payload));
    } catch {
      throw new BackupError('wrong-password');
    }
    try {
      data = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new BackupError('invalid');
    }
  } else {
    data = envelope.data;
  }
  if (!validateBackupData(data)) throw new BackupError('invalid');
  return {
    ...data,
    epgSources: Array.isArray(data.epgSources) ? data.epgSources : [],
    settings: { ...DEFAULT_SETTINGS, ...data.settings, parental: { ...DEFAULT_SETTINGS.parental, ...data.settings.parental } },
  };
}
