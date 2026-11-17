'use client';

import { FileText, FileUp, Globe, Link2, ListVideo, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Playlist } from '@tuitv/shared-models';
import { maskUrl } from '@tuitv/validation';
import { AddSourceDialog, ConfirmDialog } from '@/components/dialogs';
import { Button, Empty, Field, Input, Modal, Notice, PageHeader, Switch } from '@/components/ui';
import { formatDate, importErrorText, useT } from '@/lib/i18n';
import { useStore } from '@/lib/store';

/** Minhas listas (PRD RF-003 / RF-012): várias listas, cada uma com origem, estado e atualização próprios. */
export default function PlaylistsPage() {
  const t = useT();
  const playlists = useStore((s) => s.playlists);
  const [dialog, setDialog] = useState<'url' | 'file' | null>(null);

  return (
    <>
      <PageHeader
        title={t('Minhas listas')}
        subtitle={t('As listas ficam guardadas apenas neste dispositivo.')}
        actions={
          <>
            <Button onClick={() => setDialog('file')}>
              <FileUp className="size-4" /> {t('Importar arquivo')}
            </Button>
            <Button variant="primary" onClick={() => setDialog('url')}>
              <Link2 className="size-4" /> {t('Adicionar lista')}
            </Button>
          </>
        }
      />
      {playlists.length === 0 ? (
        <Empty icon={<ListVideo className="size-10" />} title={t('Nenhuma lista cadastrada')}>
          <p>{t('Adicione uma lista M3U/M3U8 por endereço ou importe um arquivo do dispositivo.')}</p>
        </Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {playlists.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </div>
      )}
      {dialog && <AddSourceDialog kind="playlist" initialMode={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function PlaylistCard({ playlist }: { playlist: Playlist }) {
  const t = useT();
  const language = useStore((s) => s.settings.language);
  const refreshPlaylist = useStore((s) => s.refreshPlaylist);
  const renamePlaylist = useStore((s) => s.renamePlaylist);
  const setActive = useStore((s) => s.setPlaylistActive);
  const deletePlaylist = useStore((s) => s.deletePlaylist);
  const toast = useStore((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async (file?: File) => {
    setBusy(true);
    setError(null);
    try {
      await refreshPlaylist(playlist.id, file);
      toast(t('Lista “{name}” atualizada.', { name: playlist.name }), 'success');
    } catch (err) {
      setError(importErrorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const isUrl = playlist.source === 'url';
  const pending = isUrl && playlist.itemCount === 0;

  return (
    <article className="rounded-2xl border border-line bg-surface p-5" data-testid="playlist-card">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          {isUrl ? <Globe className="size-5" /> : <FileText className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold">{playlist.name}</h2>
          <p className="truncate text-xs text-muted" title={isUrl ? t('Credenciais ocultas') : undefined}>
            {isUrl ? maskUrl(playlist.url ?? '') : `${t('Arquivo')}: ${playlist.fileName ?? '—'}`}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs text-muted">
          <span className="hidden sm:inline">{playlist.active ? t('Ativa') : t('Desativada')}</span>
          <Switch checked={playlist.active} onChange={(value) => void setActive(playlist.id, value)} label={t('Ativar ou desativar a lista')} />
        </label>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        {[
          [t('Conteúdos'), playlist.itemCount.toLocaleString()],
          [t('Canais'), playlist.counts.live.toLocaleString()],
          [t('Filmes'), playlist.counts.movie.toLocaleString()],
          [t('Episódios'), playlist.counts.series.toLocaleString()],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-muted">
        {t('Atualizada em {date}', { date: formatDate(playlist.updatedAt, language) })}
        {!!playlist.skipped && ` · ${t('{n} registros inválidos ignorados', { n: playlist.skipped })}`}
      </p>

      {pending && !busy && <div className="mt-3"><Notice>{t('Lista restaurada de um backup. Atualize para baixar o conteúdo.')}</Notice></div>}
      {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}

      <div className="mt-4 flex flex-wrap gap-2">
        <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && void refresh(e.target.files[0])} />
        <Button variant={pending ? 'primary' : 'secondary'} disabled={busy} onClick={() => (isUrl ? void refresh() : fileRef.current?.click())}>
          <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
          {busy ? t('Atualizando…') : isUrl ? t('Atualizar') : t('Reimportar arquivo')}
        </Button>
        <Button disabled={busy} onClick={() => setRenaming(playlist.name)}>
          <Pencil className="size-4" /> {t('Renomear')}
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => setRemoving(true)}>
          <Trash2 className="size-4" /> {t('Excluir')}
        </Button>
      </div>

      {renaming !== null && (
        <Modal title={t('Renomear lista')} onClose={() => setRenaming(null)}>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void renamePlaylist(playlist.id, renaming);
              setRenaming(null);
            }}
          >
            <Field label={t('Nome')}>
              <Input value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={80} data-autofocus />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRenaming(null)}>
                {t('Cancelar')}
              </Button>
              <Button variant="primary" type="submit" disabled={!renaming.trim()}>
                {t('Salvar')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {removing && (
        <ConfirmDialog
          title={t('Excluir lista')}
          message={t('A lista “{name}”, seus conteúdos, favoritos e histórico serão apagados deste dispositivo.', { name: playlist.name })}
          confirmLabel={t('Excluir')}
          danger
          onConfirm={() => deletePlaylist(playlist.id)}
          onClose={() => setRemoving(false)}
        />
      )}
    </article>
  );
}
