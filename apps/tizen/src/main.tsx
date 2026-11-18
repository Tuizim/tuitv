/**
 * TuiTV para Tizen: as mesmas telas da aplicação Web (apps/web/src), sem o Next.js.
 * `next/link` e `next/navigation` são substituídos por roteamento por hash (vite.config.ts),
 * o que permite rodar a partir de file:// dentro do pacote .wgt instalado na TV.
 */
import 'core-js/stable';
import { createRoot } from 'react-dom/client';
import type { ComponentType } from 'react';
import { AppShell } from '@/components/AppShell';
import HomePage from '@/app/page';
import LivePage from '@/app/live/page';
import MoviesPage from '@/app/movies/page';
import SeriesPage from '@/app/series/page';
import SeriesViewPage from '@/app/series/view/page';
import WatchPage from '@/app/watch/page';
import GuidePage from '@/app/guide/page';
import SearchPage from '@/app/search/page';
import FavoritesPage from '@/app/favorites/page';
import HistoryPage from '@/app/history/page';
import PlaylistsPage from '@/app/playlists/page';
import SettingsPage from '@/app/settings/page';
import { installFlexGapFallback } from './flex-gap';
import { installRemote } from './remote';
import { useLocation } from './router';
import './styles.css';

const ROUTES: Record<string, ComponentType> = {
  '/': HomePage,
  '/live': LivePage,
  '/movies': MoviesPage,
  '/series': SeriesPage,
  '/series/view': SeriesViewPage,
  '/watch': WatchPage,
  '/guide': GuidePage,
  '/search': SearchPage,
  '/favorites': FavoritesPage,
  '/history': HistoryPage,
  '/playlists': PlaylistsPage,
  '/settings': SettingsPage,
};

function App() {
  const { pathname } = useLocation();
  const Page = ROUTES[pathname] ?? HomePage;
  return (
    <AppShell>
      {/* key: cada rota começa com estado novo, como numa navegação do Next.js. */}
      <Page key={pathname} />
    </AppShell>
  );
}

document.documentElement.dataset.platform = 'tizen';
installFlexGapFallback();
installRemote();
createRoot(document.getElementById('root')!).render(<App />);
