'use client';

import { FileUp, Link2 } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { isValidPin } from '@tuitv/business-rules';
import { importErrorText, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';
import { Button, Field, Input, Modal, Notice, Spinner, cx } from './ui';

type Mode = 'url' | 'file';

/** Adicionar lista M3U/M3U8 ou guia XMLTV — por endereço ou por arquivo local (PRD RF-003 / RF-009). */
export function AddSourceDialog({
  kind,
  initialMode = 'url',
  initialUrl = '',
  onClose,
  onDone,
}: {
  kind: 'playlist' | 'epg';
  initialMode?: Mode;
  initialUrl?: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useT();
  const importPlaylist = useStore((s) => s.importPlaylist);
  const addEpg = useStore((s) => s.addEpg);
  const toast = useStore((s) => s.toast);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [name, setName] = useState('');
  const [url, setUrl] = useState(initialUrl);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const job = useStore((s) => s.jobs.find((j) => j.status === 'running'));
  const isPlaylist = kind === 'playlist';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === 'file' && !file) {
      setError(t('Selecione um arquivo.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = { name, url: mode === 'url' ? url : undefined, file: mode === 'file' ? (file ?? undefined) : undefined };
      if (isPlaylist) {
        const playlist = await importPlaylist(input);
        toast(t('Lista “{name}” importada: {n} itens.', { name: playlist.name, n: playlist.itemCount }), 'success');
      } else {
        await addEpg(input);
        toast(t('Guia de programação importado.'), 'success');
      }
      onDone?.();
      onClose();
    } catch (err) {
      setError(importErrorText(t, err));
      setBusy(false);
    }
  };

  const tab = (value: Mode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      disabled={busy}
      onClick={() => {
        setMode(value);
        setError(null);
      }}
      className={cx(
        'flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition',
        mode === value ? 'bg-accent text-accent-ink' : 'text-muted hover:text-ink',
      )}
    >
      {icon} {label}
    </button>
  );

  return (
    <Modal title={isPlaylist ? t('Adicionar lista') : t('Adicionar guia de programação')} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div role="tablist" className="flex gap-1 rounded-lg bg-bg p-1">
          {tab('url', t('Por endereço'), <Link2 className="size-4" />)}
          {tab('file', t('Por arquivo'), <FileUp className="size-4" />)}
        </div>

        <Field label={t('Nome')} hint={t('Opcional. Ajuda a identificar a origem.')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder={isPlaylist ? t('Minha lista') : t('Meu guia')}
            disabled={busy}
            name="name"
            autoComplete="off"
          />
        </Field>

        {mode === 'url' ? (
          <Field
            label={isPlaylist ? t('Endereço M3U/M3U8') : t('Endereço XMLTV')}
            hint={t('O download é feito diretamente pelo seu navegador. O endereço fica guardado apenas neste dispositivo.')}
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              inputMode="url"
              placeholder="https://"
              disabled={busy}
              name="url"
              autoComplete="off"
              spellCheck={false}
              data-autofocus
            />
          </Field>
        ) : (
          <Field
            label={isPlaylist ? t('Arquivo .m3u ou .m3u8') : t('Arquivo .xml ou .xml.gz')}
            hint={t('O arquivo é lido localmente e não é enviado a nenhum servidor.')}
          >
            <input
              ref={fileRef}
              type="file"
              name="file"
              accept={isPlaylist ? '.m3u,.m3u8,audio/x-mpegurl,application/vnd.apple.mpegurl,text/plain' : '.xml,.gz,.xmltv,text/xml,application/xml,application/gzip'}
              className="sr-only"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setError(null);
              }}
            />
            <Button className="w-full justify-start" onClick={() => fileRef.current?.click()} disabled={busy}>
              <FileUp className="size-4" />
              <span className="truncate">{file ? file.name : t('Selecionar arquivo…')}</span>
            </Button>
          </Field>
        )}

        {busy && (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="size-4 text-accent" />
              {job && job.count > 0 ? t('Importando… {n} itens', { n: job.count.toLocaleString() }) : t('Baixando e validando…')}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-bg">
              <div
                className={cx('h-full rounded-full bg-accent transition-all', !job?.total && 'w-1/3 animate-pulse')}
                style={job?.total ? { width: `${Math.min(100, (job.loaded / job.total) * 100)}%` } : undefined}
              />
            </div>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t('Importando…') : t('Importar')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Solicita o PIN do controle parental. */
export function PinDialog({ title, onClose, onUnlocked }: { title?: string; onClose: () => void; onUnlocked?: () => void }) {
  const t = useT();
  const unlock = useStore((s) => s.unlock);
  const [pin, setPin] = useState('');
  const [wrong, setWrong] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!isValidPin(pin) || busy) return;
    setBusy(true);
    const ok = await unlock(pin);
    setBusy(false);
    if (ok) {
      onUnlocked?.();
      onClose();
    } else {
      setWrong(true);
      setPin('');
    }
  };

  return (
    <Modal title={title ?? t('Controle parental')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={t('Digite o PIN')}>
          <Input
            value={pin}
            onChange={(e) => {
              setPin(e.target.value.replace(/\D/g, '').slice(0, 8));
              setWrong(false);
            }}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            name="pin"
            data-autofocus
          />
        </Field>
        {wrong && <Notice tone="danger">{t('PIN incorreto.')}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t('Cancelar')}
          </Button>
          <Button variant="primary" type="submit" disabled={!isValidPin(pin) || busy}>
            {t('Desbloquear')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('Cancelar')}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            data-autofocus
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
              } finally {
                onClose();
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-muted">{message}</div>
    </Modal>
  );
}
