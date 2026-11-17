import { useCallback, useEffect, useState } from 'react';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { ParticleBackground } from './components/ParticleBackground';
import { DEFAULT_MEDIA_ASSETS } from './config/appConfig';
import { AdminPage } from './pages/AdminPage';
import { ExplorePage } from './pages/ExplorePage';
import { HomePage } from './pages/HomePage';
import { WritePage } from './pages/WritePage';
import {
  type AdminSessionUser,
  getCurrentAdminSession,
  logoutAdmin,
  publishAspiration,
  removeAspiration,
  replyToAspiration,
  seedSampleAspirations,
  signInAdminWithCredentials,
  subscribeAllAspirations,
  subscribeMediaSettings,
  subscribePublicAspirations,
  toggleAspirationVisibility,
  updateMediaSettings,
} from './services/aspirationService';
import {
  Aspiration,
  CreateAspirationInput,
  MediaAssets,
  PageRoute,
} from './types/aspiration';

const HASH_TO_ROUTE: Record<string, PageRoute> = {
  '': 'home',
  '#beranda': 'home',
  '#home': 'home',
  '#jelajahi': 'explore',
  '#tulis': 'write',
  '#admin': 'admin',
};

const ROUTE_TO_HASH: Record<PageRoute, string> = {
  home: '#beranda',
  explore: '#jelajahi',
  write: '#tulis',
  admin: '#admin',
};

function getInitialRoute(): PageRoute {
  if (typeof window === 'undefined') return 'home';
  const hash = window.location.hash.toLowerCase();
  return HASH_TO_ROUTE[hash] ?? 'home';
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageRoute>(getInitialRoute);
  const [publicAspirations, setPublicAspirations] = useState<Aspiration[]>([]);
  const [adminAspirations, setAdminAspirations] = useState<Aspiration[]>([]);
  const [isLoadingPublic, setIsLoadingPublic] = useState(true);
  const [mediaAssets, setMediaAssets] = useState<MediaAssets>(
    DEFAULT_MEDIA_ASSETS
  );

  // Pulihkan sesi admin dari Supabase Auth saat aplikasi dibuka
  const [authUser, setAuthUser] = useState<AdminSessionUser | null>(null);
  const [isAdminVerified, setIsAdminVerified] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentAdminSession().then((user) => {
      if (!active) return;
      setAuthUser(user);
      setIsAdminVerified(Boolean(user));
    }).catch(() => {
      if (!active) return;
      setAuthUser(null);
      setIsAdminVerified(false);
    });
    return () => { active = false; };
  }, []);

  // Sinkronkan navigasi dengan hash URL agar tombol Back/Forward browser berfungsi
  useEffect(() => {
    const handleHashChange = () => {
      const rawHash = window.location.hash.toLowerCase();
      const next = HASH_TO_ROUTE[rawHash] ?? 'home';
      setCurrentPage(next);
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Muat aspirasi publik dari Supabase dan pengaturan media dari LocalStorage
  useEffect(() => {
    const unsubPublic = subscribePublicAspirations(
      (items) => {
        setPublicAspirations(items);
        setIsLoadingPublic(false);
        setDataError(null);
      },
      (err) => {
        setIsLoadingPublic(false);
        setDataError(err.message);
      }
    );

    const unsubMedia = subscribeMediaSettings(
      (assets) => setMediaAssets(assets),
      (err) => setDataError(err.message)
    );

    return () => {
      unsubPublic();
      unsubMedia();
    };
  }, []);

  // Muat seluruh aspirasi (termasuk disembunyikan) saat Admin aktif
  useEffect(() => {
    if (!isAdminVerified) return;
    const unsubAdmin = subscribeAllAspirations(
      (items) => {
        setAdminAspirations(items);
        setDataError(null);
      },
      (err) => setDataError(err.message)
    );
    return () => unsubAdmin();
  }, [isAdminVerified]);

  const handleNavigate = useCallback((page: PageRoute) => {
    setCurrentPage(page);
    const targetHash = ROUTE_TO_HASH[page];
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handlePublishAspiration = useCallback(
    async (input: CreateAspirationInput) => {
      await publishAspiration(input);
    },
    []
  );

  const handleToggleVisibility = useCallback(
    async (id: string, nextHidden: boolean) => {
      if (!isAdminVerified) return;
      await toggleAspirationVisibility(id, nextHidden);
    },
    [isAdminVerified]
  );

  const handleDeleteAspiration = useCallback(
    async (id: string) => {
      if (!isAdminVerified) return;
      await removeAspiration(id);
    },
    [isAdminVerified]
  );

  const handleReplyAspiration = useCallback(
    async (id: string, reply: string) => {
      if (!isAdminVerified) return;
      await replyToAspiration(id, reply);
    },
    [isAdminVerified]
  );

  const handleSeedSamples = useCallback(async () => {
    if (!isAdminVerified) return;
    await seedSampleAspirations();
  }, [isAdminVerified]);

  const handleUpdateMedia = useCallback(
    async <K extends keyof MediaAssets>(key: K, value: MediaAssets[K]) => {
      if (!isAdminVerified) return;
      const next: MediaAssets = {
        ...mediaAssets,
        [key]: value,
      };
      await updateMediaSettings(next);
    },
    [isAdminVerified, mediaAssets]
  );

  const handleResetMedia = useCallback(
    async (key: keyof MediaAssets) => {
      if (!isAdminVerified) return;
      const next: MediaAssets = {
        ...mediaAssets,
        [key]: DEFAULT_MEDIA_ASSETS[key],
      };
      await updateMediaSettings(next);
    },
    [isAdminVerified, mediaAssets]
  );

  const handleAdminCredentialsLogin = useCallback(
    async (username: string, password: string) => {
      const user = await signInAdminWithCredentials(username, password);
      setAuthUser(user);
      setIsAdminVerified(true);
    },
    []
  );

  const handleAdminLogout = useCallback(async () => {
    await logoutAdmin();
    setAuthUser(null);
    setIsAdminVerified(false);
    setAdminAspirations([]);
  }, []);

  return (
    <div className="relative min-h-screen flex flex-col text-[#F0F7FF]">
      <ParticleBackground />

      <Header
        currentPage={currentPage}
        onNavigate={handleNavigate}
        schoolLogoUrl={mediaAssets.schoolLogoUrl}
        isAdminLoggedIn={isAdminVerified}
        onAdminLogout={() => void handleAdminLogout()}
      />

      <main className="relative z-10 flex-1 flex flex-col">
        {dataError && (
          <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4">
            <div
              role="alert"
              className="rounded-2xl bg-rose-500/20 border border-rose-300/40 px-4 py-3 flex items-center justify-between gap-3 text-sm text-rose-100"
            >
              <span>{dataError}</span>
              <button
                type="button"
                onClick={() => setDataError(null)}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 shrink-0"
              >
                Tutup
              </button>
            </div>
          </div>
        )}

        {currentPage === 'home' && (
          <HomePage
            publicAspirations={publicAspirations}
            onNavigate={handleNavigate}
          />
        )}

        {currentPage === 'explore' && (
          <ExplorePage
            aspirations={publicAspirations}
            isLoading={isLoadingPublic}
            galleryUrls={mediaAssets.exploreGalleryUrls}
            isAdminLoggedIn={isAdminVerified}
            onUpdateGallery={(urls) =>
              handleUpdateMedia('exploreGalleryUrls', urls)
            }
            onResetGallery={() => handleResetMedia('exploreGalleryUrls')}
            onNavigate={handleNavigate}
          />
        )}

        {currentPage === 'write' && (
          <WritePage
            galleryUrls={mediaAssets.writeGalleryUrls}
            isAdminLoggedIn={isAdminVerified}
            onUpdateGallery={(urls) =>
              handleUpdateMedia('writeGalleryUrls', urls)
            }
            onResetGallery={() => handleResetMedia('writeGalleryUrls')}
            onPublishAspiration={handlePublishAspiration}
            onNavigate={handleNavigate}
          />
        )}

        {currentPage === 'admin' && (
          <AdminPage
            isAuthenticated={isAdminVerified}
            authUser={authUser}
            aspirations={adminAspirations}
            mediaAssets={mediaAssets}
            onLoginWithCredentials={handleAdminCredentialsLogin}
            onLogout={handleAdminLogout}
            onToggleVisibility={handleToggleVisibility}
            onDeleteAspiration={handleDeleteAspiration}
            onReplyAspiration={handleReplyAspiration}
            onSeedSamples={handleSeedSamples}
            onUpdateMediaAsset={handleUpdateMedia}
            onResetMediaAsset={handleResetMedia}
            onNavigate={handleNavigate}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}
