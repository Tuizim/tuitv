'use client';

import { FileUp, Link2, Play, Plus, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { MediaItem } from '@tuitv/shared-models';
import { FavoriteButton, MovieCard, POSTER_SLOT, PosterCard, Row, SeriesCard } from '@/components/cards';
import { Thumb } from '@/components/Thumb';
import { AddSourceDialog } from '@/components/dialogs';
import { Logo } from '@/components/Logo';
import { Button, Notice, cx } from '@/components/ui';
import { itemHref, seriesHref, useRemoteConnection, useRemoteGroup } from '@/lib/hooks';
import { importErrorText, useT } from '@/lib/i18n';
import { useMovieInfo, useSeriesInfo } from '@/lib/meta';
import { hasRemote, useResolver, useStore } from '@/lib/store';
import type { SeriesGroup } from '@tuitv/business-rules';

export default function HomePage() {
  const playlists = useStore((s) => s.playlists);
  const [dialog, setDialog] = useState<'url' | 'file' | null>(null);
  return (
    <>
      {playlists.length === 0 ? <Welcome onAdd={setDialog} /> : <Dashboard onAdd={() => setDialog('url')} />}
      {dialog && <AddSourceDialog kind="playlist" initialMode={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

/** Primeiro acesso (PRD RF-002): boas-vindas, explicação e atalhos de importação — sem cadastro. */
function Welcome({ onAdd }: { onAdd: (mode: 'url' | 'file') => void }) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center py-8 text-center sm:py-14">
      <Logo className="text-5xl sm:text-6xl" />
      <p className="mt-3 text-sm font-semibold tracking-[0.18em] text-muted uppercase">{t('Seu entretenimento em um só lugar.')}</p>
      <h1 className="mt-10 text-2xl font-extrabold sm:text-3xl">{t('Boas-vindas ao TuiTV')}</h1>
      <p className="mt-3 max-w-xl text-muted">
        {t('O TuiTV é um player de IPTV. Importe suas próprias listas M3U/M3U8 para organizar canais, filmes e séries, consultar o guia de programação e assistir a conteúdos de fontes autorizadas.')}
      </p>
      <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Button variant="primary" className="min-h-12 px-6 text-base" onClick={() => onAdd('url')}>
          <Link2 className="size-5" /> {t('Adicionar lista')}
        </Button>
        <Button className="min-h-12 px-6 text-base" onClick={() => onAdd('file')}>
          <FileUp className="size-5" /> {t('Importar arquivo')}
        </Button>
      </div>
      <div className="mt-10 w-full rounded-2xl border border-line bg-surface p-5 text-left">
        <p className="flex items-center gap-2 font-bold">
          <ShieldCheck className="size-5 text-success" /> {t('100% local, sem conta e sem login')}
        </p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-muted">
          <li>{t('Suas listas, favoritos, histórico e configurações ficam guardados apenas neste navegador.')}</li>
          <li>{t('Nada é enviado a servidores do TuiTV: não existe cadastro, e-mail ou senha.')}</li>
          <li>{t('O TuiTV não fornece canais nem listas. Você é responsável pelas fontes que importar.')}</li>
          <li>{t('Em janelas anônimas/privadas o navegador pode apagar os dados ao fechar. Use o backup local para guardá-los.')}</li>
        </ul>
        <p className="mt-4 text-sm">
          {t('Já usa o TuiTV em outro dispositivo?')}{' '}
          <Link href="/settings#backup" className="font-semibold text-accent hover:underline">
            {t('Restaurar um backup')}
          </Link>
        </p>
      </div>
    </div>
  );
}

function Dashboard({ onAdd }: { onAdd: () => void }) {
  const t = useT();
  const lib = useStore((s) => s.lib);
  const history = useStore((s) => s.history);
  const favorites = useStore((s) => s.favorites);
  const jobs = useStore((s) => s.jobs);
  const remote = useStore(hasRemote);
  const connection = useRemoteConnection();
  const resolve = useResolver();

  const { resume, lastChannel } = useMemo(() => {
    const resume: { item: MediaItem; progress: number }[] = [];
    let lastChannel: MediaItem | undefined;
    for (const entry of history) {
      const item = resolve.item(entry.itemId);
      if (!item) continue;
      if (item.kind === 'live') {
        lastChannel ??= item;
      } else if (!entry.completed && entry.position > 30 && entry.duration > 0 && resume.length < 20) {
        resume.push({ item, progress: entry.position / entry.duration });
      }
    }
    return { resume, lastChannel };
  }, [history, resolve]);

  const favoriteItems = useMemo(() => {
    const list = [...favorites.values()].sort((a, b) => b.addedAt - a.addedAt).slice(0, 30);
    return list
      .map((f) => (f.kind === 'series' ? { series: resolve.series(f.id) } : { item: resolve.item(f.id) }))
      // A tela inicial mostra apenas filmes e séries; canais favoritos ficam em Favoritos e na TV ao vivo.
      .filter((f) => f.series || f.item?.kind === 'movie');
  }, [favorites, resolve]);

  // Fileiras por categoria: as primeiras categorias de cada tipo, na ordem das listas.
  // Com login, cada fileira é pedida ao servidor; por isso são menos fileiras.
  const groupRows = useMemo(() => {
    const limit = remote ? 3 : 6;
    const take = <T extends { group?: string }>(items: T[], groups: { name: string }[]) =>
      groups.slice(0, limit).map((g) => ({ name: g.name, items: items.filter((i) => i.group === g.name).slice(0, 20) }));
    return {
      movies: take(lib.movies, lib.movieGroups),
      series: take(lib.series, lib.seriesGroups),
    };
  }, [lib, remote]);

  const failed = jobs.filter((j) => j.status === 'error');
  const empty =
    !connection.loading && lib.live.length + lib.movies.length + lib.series.length === 0 && lib.liveGroups.length + lib.movieGroups.length + lib.seriesGroups.length === 0;

  return (
    <>
      <Hero resume={resume[0]} lastChannel={lastChannel} />

      {failed.map((job) => (
        <div key={job.id} className="mb-3">
          <Notice tone="danger">
            <strong>{job.name}:</strong> {importErrorText(t, job.error)}
          </Notice>
        </div>
      ))}
      {empty && (
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Notice>
            {t('Nenhum conteúdo disponível nas listas ativas.')}{' '}
            <Link href="/playlists" className="font-semibold text-accent hover:underline">
              {t('Gerenciar listas')}
            </Link>
          </Notice>
          <Button variant="primary" onClick={onAdd}>
            <Plus className="size-4" /> {t('Adicionar lista')}
          </Button>
        </div>
      )}

      {resume.length > 0 && (
        <Row title={t('Continuar assistindo')} href="/history">
          {resume.map(({ item, progress }) => (
            <div key={item.id} className={POSTER_SLOT}>
              <PosterCard href={itemHref(item)} title={item.name} image={item.logo} progress={progress} />
            </div>
          ))}
        </Row>
      )}

      {favoriteItems.length > 0 && (
        <Row title={t('Favoritos')} href="/favorites">
          {favoriteItems.map((f) =>
            f.series ? (
              <div key={f.series.id} className={POSTER_SLOT}>
                <SeriesCard series={f.series} />
              </div>
            ) : (
              <div key={f.item!.id} className={POSTER_SLOT}>
                <MovieCard item={f.item!} />
              </div>
            ),
          )}
        </Row>
      )}

      {groupRows.movies.map((row) => (
        <GroupRow key={`m${row.name}`} kind="movie" name={row.name} items={row.items} />
      ))}
      {groupRows.series.map((row) => (
        <GroupRow key={`s${row.name}`} kind="series" name={row.name} items={row.items} />
      ))}
    </>
  );
}

/** Fileira de uma categoria; com login, os títulos são pedidos ao servidor quando a fileira aparece. */
function GroupRow(props: { kind: 'movie'; name: string; items: MediaItem[] } | { kind: 'series'; name: string; items: SeriesGroup[] }) {
  useRemoteGroup(props.kind, props.name, props.items.length === 0);
  if (props.items.length === 0) return null;
  const href = `/${props.kind === 'movie' ? 'movies' : 'series'}?g=${encodeURIComponent(props.name)}`;
  return (
    <Row title={props.name} href={href}>
      {props.kind === 'movie'
        ? props.items.map((item) => (
            <div key={item.id} className={POSTER_SLOT}>
              <MovieCard item={item} />
            </div>
          ))
        : props.items.map((series) => (
            <div key={series.id} className={POSTER_SLOT}>
              <SeriesCard series={series} />
            </div>
          ))}
    </Row>
  );
}

/**
 * Destaque da tela inicial: o que o usuário estava assistindo ou, na falta disso,
 * um título da biblioteca que muda a cada dia.
 */
function Hero({ resume, lastChannel }: { resume?: { item: MediaItem; progress: number }; lastChannel?: MediaItem }) {
  const t = useT();
  const lib = useStore((s) => s.lib);

  const featured = useMemo(() => {
    if (resume) return { label: t('Continuar assistindo'), title: resume.item.name, image: resume.item.logo, href: itemHref(resume.item), meta: [resume.item.year, resume.item.group], item: resume.item };
    const day = Math.floor(Date.now() / 86_400_000);
    const movies = lib.movies.filter((m) => m.logo).slice(0, 400);
    if (movies.length) {
      const item = movies[day % movies.length]!;
      return { label: t('Destaque de hoje'), title: item.name, image: item.logo, href: itemHref(item), meta: [item.year, item.group], item };
    }
    const series = lib.series.filter((s) => s.logo).slice(0, 400);
    if (series.length) {
      const pick = series[day % series.length]!;
      return { label: t('Destaque de hoje'), title: pick.title, image: pick.logo, href: seriesHref(pick.id), meta: [pick.year, pick.group, t('{n} episódios', { n: pick.episodeCount })], series: pick };
    }
    const channel = lastChannel ?? lib.live[0];
    if (channel) return { label: t('TV ao vivo'), title: channel.name, image: channel.logo, href: itemHref(channel), meta: [channel.group], item: channel, wide: true };
    return null;
  }, [resume, lastChannel, lib, t]);

  const movieInfo = useMovieInfo(featured?.item?.kind === 'movie' ? featured.item : undefined);
  const seriesInfo = useSeriesInfo(featured && 'series' in featured ? featured.series : undefined);
  const plot = movieInfo?.plot ?? seriesInfo?.plot ?? featured?.item?.description;

  if (!featured) return null;
  const stats = [
    { href: '/movies', label: t('{n} filmes', { n: lib.movies.length.toLocaleString() }), show: lib.movies.length > 0 },
    { href: '/series', label: t('{n} séries', { n: lib.series.length.toLocaleString() }), show: lib.series.length > 0 },
  ].filter((s) => s.show);

  return (
    <section className="relative -mx-4 -mt-20 mb-8 flex min-h-[26rem] items-end overflow-hidden px-4 pt-24 pb-8 sm:min-h-[30rem] lg:-mx-12 lg:px-12" data-testid="hero">
      {featured.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={featured.image} alt="" referrerPolicy="no-referrer" className="absolute inset-0 size-full scale-125 object-cover opacity-45 blur-3xl" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/70 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" />

      <div className="relative flex w-full items-end justify-between gap-8">
        <div className="max-w-xl min-w-0">
          <p className="text-xs font-bold tracking-[0.2em] text-accent uppercase">{featured.label}</p>
          <h1 className="mt-2 line-clamp-3 text-3xl leading-tight font-extrabold tracking-tight sm:text-5xl">{featured.title}</h1>
          <p className="mt-3 text-sm text-muted">{featured.meta.filter(Boolean).join(' · ')}</p>
          {plot && <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-ink/85">{plot}</p>}
          {resume && (
            <div className="mt-4 h-1 w-56 max-w-full overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-accent" style={{ width: `${Math.min(100, resume.progress * 100)}%` }} />
            </div>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link href={featured.href} className="inline-flex h-12 items-center gap-2 rounded-lg bg-white px-7 text-base font-bold text-[#070c16] transition hover:bg-white/85">
              <Play className="size-5" fill="currentColor" /> {resume ? t('Continuar') : t('Assistir')}
            </Link>
            {featured.item && featured.item.kind !== 'series' && (
              <FavoriteButton id={featured.item.id} kind={featured.item.kind} playlistId={featured.item.playlistId} withLabel className="h-12 bg-white/10 backdrop-blur" />
            )}
          </div>
          <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {stats.map((s) => (
              <Link key={s.href} href={s.href} className="hover:text-ink">
                {s.label}
              </Link>
            ))}
          </p>
        </div>
        {featured.image && (
          <Thumb
            src={featured.image}
            name={featured.title}
            fit={featured.wide ? 'contain' : 'cover'}
            className={cx('hidden shrink-0 rounded-xl shadow-2xl shadow-black/70 ring-1 ring-white/10 md:flex', featured.wide ? 'aspect-video w-72' : 'aspect-[2/3] w-52 lg:w-60')}
          />
        )}
      </div>
    </section>
  );
}
