import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  ArrowLeft,
  Bookmark,
  BookOpen,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Filter,
  Headphones,
  Home,
  Library,
  LogIn,
  LogOut,
  Menu,
  Minus,
  Pencil,
  Pause,
  Play,
  Plus,
  Rewind,
  Search,
  Settings,
  Share2,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react';
import type { AudioChapter, Chapter, ChapterContent, MockUser, ReaderSettings, Story } from './types';
import { api } from './lib/api';
import { appInfo } from './lib/appInfo';
import { downloadApk, getDeviceProfile } from './lib/appUpdater';
import { officialUpdateUrl, storage, syncAccounts } from './lib/storage';
import { useLibraryStore } from './store/useLibraryStore';
import { chapterLabel, clamp, formatDateTime, formatMinutes } from './utils/format';
import { chapterToBlocks } from './utils/markdown';

type Route =
  | { name: 'home' }
  | { name: 'story'; storyId: string }
  | { name: 'reader'; storyId: string; chapterNumber: number }
  | { name: 'me' }
  | { name: 'audio' }
  | { name: 'library' };

const now = () => new Date().toISOString();
let remoteSyncPromise: Promise<unknown> | null = null;
let lastRemoteSync = 0;
const triggeredImageKey = 'leafnovel:triggered-images';

function parseRoute(pathname = window.location.pathname): Route {
  const parts = pathname.split('/').filter(Boolean);
  if (!parts.length) return { name: 'home' };
  if (parts[0] === 'story' && parts[1]) return { name: 'story', storyId: parts[1] };
  if (parts[0] === 'read' && parts[1] && parts[2]) {
    return { name: 'reader', storyId: parts[1], chapterNumber: Number(parts[2]) || 1 };
  }
  if (parts[0] === 'me') return { name: 'me' };
  if (parts[0] === 'search' || parts[0] === 'discover' || parts[0] === 'audio') return { name: 'audio' };
  if (parts[0] === 'library') return { name: 'library' };
  return { name: 'home' };
}

function navigate(path: string) {
  window.history.pushState({ app: true }, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function readStringSet(key: string) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set<string>(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set<string>();
  }
}

function hasStoredFlag(key: string, value: string) {
  return readStringSet(key).has(value);
}

function addStoredFlag(key: string, value: string) {
  const next = readStringSet(key);
  next.add(value);
  localStorage.setItem(key, JSON.stringify(Array.from(next)));
}

function useRoute() {
  const [route, setRoute] = useState<Route>(() => parseRoute());
  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

function App() {
  const route = useRoute();
  const darkMode = useLibraryStore((state) => state.settings.darkMode);
  const user = useLibraryStore((state) => state.user);
  const [bootReady, setBootReady] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setBootReady(true), 650);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let disposed = false;
    let removeListener: (() => void) | undefined;

    CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      const currentRoute = parseRoute();
      if (currentRoute.name === 'reader') {
        navigate(`/story/${currentRoute.storyId}`);
        return;
      }
      if (currentRoute.name !== 'home') {
        navigate('/');
        return;
      }
      if (canGoBack && window.history.length > 1) {
        window.history.back();
        return;
      }
      CapacitorApp.exitApp();
    }).then((handle) => {
      removeListener = () => handle.remove();
      if (disposed) removeListener();
    });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, []);

  if (!bootReady) return <LoadingPage label="Đang mở Leaf Novel..." fullScreen />;
  if (!user) return <LoginPage />;

  return (
    <div className={`min-h-screen text-app-text ${darkMode ? 'app-dark bg-[#080D14]' : 'bg-[#EDEFF0]'}`}>
      {route.name === 'reader' ? (
        <ReaderPage storyId={route.storyId} chapterNumber={route.chapterNumber} />
      ) : (
        <AppShell active={route.name} darkMode={darkMode}>
          {route.name === 'home' && <HomePage />}
          {route.name === 'story' && <StoryDetailPage storyId={route.storyId} />}
          {route.name === 'me' && <MePage />}
          {route.name === 'audio' && <AudioPage />}
          {route.name === 'library' && <LibraryPage />}
        </AppShell>
      )}
    </div>
  );
}

function AppShell({ active, children, darkMode }: { active: Route['name']; children: ReactNode; darkMode: boolean }) {
  return (
    <main className={`app-shell mx-auto min-h-screen w-full max-w-[480px] overflow-hidden pb-[calc(92px+env(safe-area-inset-bottom))] shadow-[0_0_60px_rgba(16,24,40,0.08)] md:max-w-none md:pb-[calc(104px+env(safe-area-inset-bottom))] ${darkMode ? 'bg-[#0B111B] text-[#F8FAFC]' : 'bg-app-bg'}`}>
      {children}
      <BottomNav active={active} darkMode={darkMode} />
    </main>
  );
}

function BottomNav({ active, darkMode }: { active: Route['name']; darkMode: boolean }) {
  const items = [
    { label: 'Trang chủ', icon: Home, path: '/', match: 'home' },
    { label: 'Audio', icon: Headphones, path: '/audio', match: 'audio' },
    { label: 'Thư viện', icon: Library, path: '/library', match: 'library' },
    { label: 'Tài khoản', icon: UserRound, path: '/me', match: 'me' },
  ] as const;

  return (
    <nav className={`fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[480px] border-t px-3 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:max-w-none md:px-8 ${darkMode ? 'border-white/10 bg-[#0B111B]/[0.92]' : 'border-app-border/80 bg-white/[0.92]'}`}>
      <div className="grid grid-cols-4 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.match;
          return (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-[11px] font-semibold transition active:scale-[0.98] md:min-h-16 md:text-[13px] ${
                isActive ? 'bg-app-primarySoft text-app-primaryDark' : darkMode ? 'text-slate-400' : 'text-app-muted'
              }`}
            >
              <Icon size={21} strokeWidth={isActive ? 2.6 : 2.2} />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function IconButton({
  label,
  children,
  onClick,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-full border border-app-border bg-white text-app-text shadow-soft transition active:scale-[0.96] ${className}`}
    >
      {children}
    </button>
  );
}

function LoginPage() {
  const login = useLibraryStore((state) => state.login);
  const savedLogin = storage.getSavedLogin();
  const [username, setUsername] = useState(savedLogin.remember ? savedLogin.username : '');
  const [password, setPassword] = useState(savedLogin.remember ? savedLogin.password : '');
  const [remember, setRemember] = useState(savedLogin.remember);
  const [error, setError] = useState('');

  useEffect(() => {
    syncAccounts().catch(() => undefined);
  }, []);

  const submit = async () => {
    setError('');
    await syncAccounts();
    if (login(username, password)) {
      storage.setSavedLogin({ username: username.trim(), password, remember });
      navigate('/');
      return;
    }
    setError('Sai ID hoặc mật khẩu.');
  };

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-[480px] place-items-center bg-app-bg px-5 md:max-w-none md:px-10">
      <section className="w-full max-w-[520px] rounded-[28px] bg-white p-6 shadow-soft md:p-8">
        <img src="/brand/clover-icon.png" alt="Leaf Novel" className="mx-auto h-20 w-20 object-contain" />
        <h1 className="mt-4 text-center text-[30px] font-semibold leading-tight">Leaf Novel</h1>
        <div className="mt-6 space-y-3">
          <label className="block">
            <span className="mb-2 block text-[14px] font-semibold text-app-muted">ID tài khoản</span>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="min-h-12 w-full rounded-button border border-app-border px-4 text-[16px] font-semibold outline-none focus:border-app-primary"
              autoComplete="username"
              placeholder="Nhập ID"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-[14px] font-semibold text-app-muted">Mật khẩu</span>
            <input
              value={password}
              type="password"
              onChange={(event) => setPassword(event.target.value)}
              className="min-h-12 w-full rounded-button border border-app-border px-4 text-[16px] font-semibold outline-none focus:border-app-primary"
              autoComplete="current-password"
              placeholder="Nhập mật khẩu"
            />
          </label>
          <label className="flex min-h-11 items-center justify-between rounded-2xl bg-app-bg px-4 text-[15px] font-semibold">
            <span>Lưu thông tin đăng nhập</span>
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-5 w-5 accent-app-primary" />
          </label>
          {error && <p className="text-center text-[14px] font-semibold text-app-danger">{error}</p>}
          <button
            type="button"
            onClick={submit}
            className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-button bg-app-primary text-[16px] font-semibold text-white shadow-soft active:scale-[0.98]"
          >
            <LogIn size={19} />
            Đăng nhập
          </button>
        </div>
      </section>
    </main>
  );
}

function useStories() {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const autoUpdate = useLibraryStore((state) => state.settings.autoUpdate);

  useEffect(() => {
    let mounted = true;
    const load = () => api.stories().then((data) => {
      if (!mounted) return;
      setStories(data);
      setLoading(false);
    });
    const syncAndLoad = () => {
      load();
      if (!autoUpdate) return;
      const stale = Date.now() - lastRemoteSync > 10 * 60_000;
      if (!remoteSyncPromise && stale) {
        remoteSyncPromise = api
          .syncRemote(officialUpdateUrl)
          .then(() => {
            lastRemoteSync = Date.now();
          })
          .catch(() => undefined)
          .finally(() => {
            remoteSyncPromise = null;
          });
      }
      remoteSyncPromise?.then(load);
    };
    load();
    syncAndLoad();
    const interval = window.setInterval(syncAndLoad, 10 * 60_000);
    window.addEventListener('leafnovel:local-library-updated', load);
    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener('leafnovel:local-library-updated', load);
    };
  }, [autoUpdate]);

  return { stories, loading };
}

function HomePage() {
  const { stories, loading } = useStories();
  const progress = useLibraryStore((state) => state.progress);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);

  const genres = useMemo(() => Array.from(new Set(stories.flatMap((story) => story.genres))).slice(0, 8), [stories]);
  const filteredStories = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('vi-VN');
    return stories.filter((story) => {
      const matchQuery =
        !needle ||
        story.title.toLocaleLowerCase('vi-VN').includes(needle) ||
        story.genres.some((genre) => genre.toLocaleLowerCase('vi-VN').includes(needle));
      const matchGenre = !selectedGenres.length || story.genres.some((genre) => selectedGenres.includes(genre));
      return matchQuery && matchGenre;
    });
  }, [stories, query, selectedGenres]);

  const latestProgress = Object.values(progress).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];
  const continueStory = latestProgress ? stories.find((story) => story.id === latestProgress.storyId) : stories[0];
  const continueProgress = latestProgress ?? (continueStory ? { storyId: continueStory.id, chapterNumber: 1, scrollPercent: 0, updatedAt: now() } : undefined);

  return (
    <section className="space-y-7 px-5 pb-8 pt-[calc(18px+env(safe-area-inset-top))] md:px-8 md:pt-[calc(26px+env(safe-area-inset-top))]">
      <div className="flex min-h-12 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <img src="/brand/clover-icon.png" alt="Leaf Novel" className="h-9 w-9 shrink-0 object-contain" />
          <h1 className="truncate text-[20px] font-semibold leading-none tracking-normal">Leaf Novel</h1>
        </div>
        <div className="flex items-center gap-2">
          <IconButton label="Tìm truyện" onClick={() => setSearchOpen(true)}>
            <Search size={20} />
          </IconButton>
          <button
            type="button"
            onClick={() => navigate('/me')}
            className="grid h-11 w-11 place-items-center rounded-full bg-app-primarySoft text-app-primaryDark transition active:scale-[0.96]"
            aria-label="Tài khoản"
          >
            <CircleUserRound size={23} />
          </button>
        </div>
      </div>

      {searchOpen && (
        <div className="fixed inset-x-0 top-0 z-50 mx-auto w-full max-w-[480px] bg-app-bg px-5 pb-4 pt-[calc(18px+env(safe-area-inset-top))] shadow-float animate-slideDown md:max-w-none md:px-8">
          <div className="flex items-center gap-3">
            <div className="flex min-h-12 flex-1 items-center gap-3 rounded-button border border-app-border bg-white px-4 shadow-soft">
              <Search size={20} className="text-app-muted" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm truyện..."
                className="w-full bg-transparent text-[17px] outline-none placeholder:text-app-muted"
              />
            </div>
            <IconButton label="Đóng tìm kiếm" onClick={() => setSearchOpen(false)}>
              <X size={20} />
            </IconButton>
          </div>
        </div>
      )}

      <ContinueReadingCard story={continueStory} progress={continueProgress} />

      <div className="flex items-center justify-between">
        <SectionHeader eyebrow="Nổi bật hôm nay" title="Truyện hợp mood" />
        <button
          type="button"
          onClick={() => setFilterOpen(true)}
          className="flex min-h-11 items-center gap-2 rounded-full border border-app-border bg-white px-4 text-[15px] font-medium shadow-soft active:scale-[0.98]"
        >
          <Filter size={17} />
          Lọc
        </button>
      </div>

      {loading ? <SkeletonGrid /> : <FeaturedCarousel stories={filteredStories.slice(0, 3)} />}

      <section className="space-y-3">
        <SectionHeader title="Truyện hot" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
          {filteredStories.slice(0, 4).map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      </section>

      <FilterSheet
        open={filterOpen}
        genres={genres}
        selectedGenres={selectedGenres}
        onChange={setSelectedGenres}
        onClose={() => setFilterOpen(false)}
      />
    </section>
  );
}

function ContinueReadingCard({ story, progress }: { story?: Story; progress?: { chapterNumber: number; scrollPercent: number; updatedAt: string } }) {
  if (!story || !progress) {
    return (
      <div className="rounded-card border border-dashed border-app-border bg-white p-5 text-center text-app-muted">
        Chưa có truyện trong thư mục local.
      </div>
    );
  }

  return (
    <article className="continue-card rounded-[26px] bg-gradient-to-br from-[#E6FAF6] via-white to-[#DDF7F5] p-4 shadow-soft">
      <div className="flex items-stretch gap-4">
        <Cover story={story} className="h-36 w-24 shrink-0 rounded-[20px]" />
        <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-app-primaryDark">Đọc tiếp</p>
            <h2 className="mt-1 line-clamp-2 text-[20px] font-semibold leading-tight">{story.title}</h2>
            <p className="mt-2 text-[14px] font-semibold text-app-muted">{chapterLabel(progress.chapterNumber, story.totalChapters)}</p>
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/90">
            <div className="h-2 rounded-full bg-app-primary" style={{ width: `${clamp(progress.scrollPercent, 0, 100)}%` }} />
          </div>
          <button
            type="button"
            onClick={() => navigate(`/read/${story.id}/${progress.chapterNumber}`)}
            className="mt-3 flex min-h-11 w-full items-center justify-center rounded-button bg-app-primary px-5 text-center text-[15px] font-semibold text-white shadow-soft active:scale-[0.98]"
          >
            Đọc tiếp
          </button>
        </div>
      </div>
      <p className="mt-3 text-center text-[13px] font-semibold text-app-muted">Đọc lần cuối: {formatDateTime(progress.updatedAt)}</p>
    </article>
  );
}

function SectionHeader({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <div>
      {eyebrow && <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-app-primaryDark">{eyebrow}</p>}
      <h2 className="text-[22px] font-semibold leading-tight">{title}</h2>
    </div>
  );
}

function FeaturedCarousel({ stories }: { stories: Story[] }) {
  if (!stories.length) return <EmptyCard text="Không tìm thấy truyện phù hợp." />;
  return (
    <div className="-mx-5 flex gap-4 overflow-x-auto px-5 pb-1 scrollbar-hide">
      {stories.map((story, index) => (
        <button
          key={story.id}
          type="button"
          onClick={() => navigate(`/story/${story.id}`)}
          className="relative w-[68%] max-w-[260px] shrink-0 overflow-hidden rounded-[28px] bg-white text-left shadow-soft active:scale-[0.99] md:w-[32%] md:max-w-[280px]"
        >
          <Cover story={story} className="h-52 w-full rounded-none md:h-60" />
          <span className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-[16px] font-semibold text-app-primaryDark shadow-soft">
            {index + 1}
          </span>
          <div className="p-4">
            <h3 className="line-clamp-2 text-[19px] font-semibold leading-snug">{story.title}</h3>
            <p className="mt-2 text-[14px] font-semibold text-app-muted">{story.status} • {story.totalChapters} chương</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function StoryCard({ story }: { story: Story }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`/story/${story.id}`)}
      className="overflow-hidden rounded-card bg-white text-left shadow-soft transition active:scale-[0.98]"
    >
      <Cover story={story} className="h-44 w-full rounded-none md:h-52" />
      <div className="p-3.5">
        <h3 className="line-clamp-2 min-h-[48px] text-[17px] font-semibold leading-snug">{story.title}</h3>
      </div>
    </button>
  );
}

function Cover({ story, className = '' }: { story: Story; className?: string }) {
  return (
    <img
      src={story.coverUrl}
      alt={story.title}
      className={`object-cover ${className}`}
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.display = 'none';
      }}
    />
  );
}

function FilterSheet({
  open,
  genres,
  selectedGenres,
  onChange,
  onClose,
}: {
  open: boolean;
  genres: string[];
  selectedGenres: string[];
  onChange: (genres: string[]) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const toggle = (genre: string) => {
    onChange(selectedGenres.includes(genre) ? selectedGenres.filter((item) => item !== genre) : [...selectedGenres, genre]);
  };
  return (
    <BottomSheet title="Lọc truyện" onClose={onClose}>
      <div className="space-y-5">
        <div>
          <p className="mb-3 text-[15px] font-semibold">Thể loại</p>
          <div className="flex flex-wrap gap-2">
            {genres.map((genre) => {
              const active = selectedGenres.includes(genre);
              return (
                <button
                  type="button"
                  key={genre}
                  onClick={() => toggle(genre)}
                  className={`min-h-11 rounded-full border px-4 text-[15px] font-medium transition active:scale-[0.98] ${
                    active ? 'border-app-primary bg-app-primarySoft text-app-primaryDark' : 'border-app-border bg-white text-app-muted'
                  }`}
                >
                  {genre}
                </button>
              );
            })}
          </div>
        </div>
      <div className="grid grid-cols-2 gap-3 md:max-w-[520px]">
          <button type="button" onClick={() => onChange([])} className="min-h-12 rounded-button border border-app-border font-semibold">
            Xóa lọc
          </button>
          <button type="button" onClick={onClose} className="min-h-12 rounded-button bg-app-primary font-semibold text-white">
            Áp dụng
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

function StoryDetailPage({ storyId }: { storyId: string }) {
  const [story, setStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const darkMode = useLibraryStore((state) => state.settings.darkMode);
  const progress = useLibraryStore((state) => state.progress[storyId]);

  useEffect(() => {
    api.story(storyId).then(setStory);
    api.chapters(storyId).then(setChapters);
  }, [storyId]);

  if (!story) return <LoadingPage label="Đang mở truyện..." />;
  const latestChapter = progress?.chapterNumber ?? 1;
  const visibleChapters = [...chapters].reverse().slice(0, 8);

  return (
    <section className="space-y-5 px-5 pb-8 pt-[calc(14px+env(safe-area-inset-top))] md:px-8">
      <TopBar title={story.title} darkMode={darkMode} onBack={() => navigate('/')} right={<><Bookmark size={20} /><Share2 size={20} /></>} />

      <Cover story={story} className="h-[300px] w-full rounded-[28px] shadow-soft md:h-[420px]" />

      <div>
        <h1 className="text-[32px] font-semibold leading-tight">{story.title}</h1>
        <p className="mt-2 text-[16px] font-medium text-app-muted">{story.status} • {story.totalChapters} chương</p>
      </div>

      <div className="grid grid-cols-[1fr_0.84fr] gap-3 md:max-w-[520px]">
        <button
          type="button"
          onClick={() => navigate(`/read/${story.id}/${latestChapter}`)}
          className="flex min-h-[52px] items-center justify-center rounded-button bg-app-primary px-4 text-center text-[17px] font-semibold text-white shadow-soft active:scale-[0.98]"
        >
          Đọc tiếp
        </button>
        <button
          type="button"
          onClick={() => navigate(`/read/${story.id}/1`)}
          className={`flex min-h-[52px] items-center justify-center rounded-button border border-app-border px-4 text-center text-[17px] font-semibold shadow-soft active:scale-[0.98] ${
            darkMode ? 'bg-[#111827] text-[#F8FAFC]' : 'bg-white text-app-text'
          }`}
        >
          Đọc từ đầu
        </button>
      </div>

      <InfoCard icon={<BookOpen size={20} />} title="Tóm tắt" text={story.summary} darkMode={darkMode} />
      <InfoCard title="Mô tả" text={story.description} darkMode={darkMode} />

      <section className={`rounded-card p-4 shadow-soft ${darkMode ? 'bg-[#111827]' : 'bg-white'}`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[21px] font-semibold">Danh sách chương</h2>
          {progress && (
            <span className="rounded-full bg-app-primarySoft px-3 py-2 text-[13px] font-semibold text-app-primaryDark">
              Đọc tiếp từ chương {progress.chapterNumber}
            </span>
          )}
        </div>
        <div className="divide-y divide-app-border">
          {visibleChapters.map((chapter) => {
            const titleHasChapterNumber = new RegExp(`^\\s*Chương\\s+0*${chapter.number}(\\D|$)`, 'i').test(chapter.title);
            const chapterLabel = titleHasChapterNumber ? chapter.title : `Chương ${chapter.number} – ${chapter.title}`;

            return (
              <button
                type="button"
                key={chapter.filename}
                onClick={() => navigate(`/read/${story.id}/${chapter.number}`)}
                className={`flex min-h-[64px] w-full items-center gap-3 rounded-2xl px-2 py-3 text-left active:scale-[0.99] ${
                  darkMode ? 'text-[#F8FAFC] active:bg-white/5' : 'text-app-text active:bg-app-bg'
                }`}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-2xl bg-app-primarySoft text-app-primaryDark">
                  {chapter.thumbnailUrl ? (
                    <img src={chapter.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <BookOpen size={18} />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-[16px] font-medium leading-snug">{chapterLabel}</span>
                <ChevronRight size={19} className="text-app-muted" />
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}

function TopBar({ title, onBack, right, darkMode = false }: { title: string; onBack: () => void; right?: ReactNode; darkMode?: boolean }) {
  return (
    <div
      className={`sticky top-0 z-20 -mx-5 flex min-h-14 items-center gap-3 px-5 backdrop-blur-xl md:-mx-8 md:px-8 ${
        darkMode ? 'bg-[#0B111B]/90 text-[#F8FAFC]' : 'bg-app-bg/90 text-app-text'
      }`}
    >
      <IconButton label="Quay lại" onClick={onBack} className={`shadow-none ${darkMode ? '!border-white/10 !bg-white/10 !text-white' : ''}`}>
        <ArrowLeft size={21} />
      </IconButton>
      <p className="min-w-0 flex-1 truncate text-[16px] font-semibold">{title}</p>
      {right && <div className={`flex items-center gap-2 ${darkMode ? 'text-[#F8FAFC]' : 'text-app-text'}`}>{right}</div>}
    </div>
  );
}

function InfoCard({ icon, title, text, darkMode = false }: { icon?: ReactNode; title: string; text: string; darkMode?: boolean }) {
  return (
    <section className={`rounded-card p-5 shadow-soft ${darkMode ? 'bg-[#111827]' : 'bg-white'}`}>
      <h2 className="mb-3 flex items-center gap-2 text-[21px] font-semibold">
        {icon && <span className="text-app-primaryDark">{icon}</span>}
        {title}
      </h2>
      <p className={`text-[17px] font-medium leading-8 ${darkMode ? 'text-slate-300' : 'text-[#344054]'}`}>{text}</p>
    </section>
  );
}

function ReaderPage({ storyId, chapterNumber }: { storyId: string; chapterNumber: number }) {
  const [story, setStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapter, setChapter] = useState<ChapterContent | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [hasReachedChapterEnd, setHasReachedChapterEnd] = useState(false);
  const settings = useLibraryStore((state) => state.settings);
  const progress = useLibraryStore((state) => state.progress[storyId]);
  const saveProgress = useLibraryStore((state) => state.saveProgress);
  const addReadingMinute = useLibraryStore((state) => state.addReadingMinute);

  useEffect(() => {
    const state = window.history.state as { app?: boolean; readerGuard?: string } | null;
    const readerGuard = `${storyId}:${chapterNumber}`;
    if (state?.app) return;
    window.history.replaceState({ app: true, readerFallback: true }, '', `/story/${storyId}`);
    window.history.pushState({ app: true, readerGuard }, '', `/read/${storyId}/${chapterNumber}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [chapterNumber, storyId]);

  useEffect(() => {
    const onPop = () => {
      const state = window.history.state as { readerSettings?: boolean } | null;
      if (!state?.readerSettings) setSettingsOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    api.story(storyId).then(setStory);
    api.chapters(storyId).then(setChapters);
    setChapter(null);
    setChapterError(null);
    api
      .chapter(storyId, chapterNumber)
      .then(setChapter)
      .catch(() => setChapterError('Không tải được chương từ thư mục local.'));
    setHasReachedChapterEnd(false);
  }, [storyId, chapterNumber]);

  useEffect(() => {
    const interval = window.setInterval(() => addReadingMinute(storyId), 60_000);
    return () => window.clearInterval(interval);
  }, [addReadingMinute, storyId]);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      if (progress?.chapterNumber !== chapterNumber) return;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: (maxScroll * progress.scrollPercent) / 100, behavior: 'auto' });
    }, 160);
    return () => window.clearTimeout(restore);
  }, [chapterNumber, progress]);

  useEffect(() => {
    let timeout: number | undefined;
    let lastY = window.scrollY;
    const onScroll = () => {
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const percent = clamp((window.scrollY / maxScroll) * 100, 0, 100);
      setScrollPercent(percent);
      if (percent > 86) setHasReachedChapterEnd(true);
      if (settings.hideUI && window.scrollY > lastY + 8) setUiVisible(false);
      if (window.scrollY < lastY - 12) setUiVisible(true);
      lastY = window.scrollY;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        saveProgress({ storyId, chapterNumber, scrollPercent: percent, updatedAt: now() });
      }, 700);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('scroll', onScroll);
    };
  }, [chapterNumber, saveProgress, settings.hideUI, storyId]);

  const blocks = useMemo(
    () => chapterToBlocks(chapter?.content ?? '', chapter?.contentFormat ?? 'markdown'),
    [chapter?.content, chapter?.contentFormat],
  );
  const currentIndex = chapters.findIndex((item) => item.number === chapterNumber);
  const nextChapter = currentIndex >= 0 ? chapters[currentIndex + 1] : undefined;
  const showNextChapter = hasReachedChapterEnd && !!nextChapter;
  const effectiveBackground = settings.darkMode ? 'dark' : settings.background;
  const bgClass = readerBgClass(effectiveBackground);
  const fontClass = settings.fontFamily === 'serif' ? 'font-serif' : 'font-sans';
  const readerIsDark = effectiveBackground === 'dark';
  const openReaderSettings = () => {
    window.history.pushState({ app: true, readerSettings: true }, '', `/read/${storyId}/${chapterNumber}`);
    setSettingsOpen(true);
  };
  const closeReaderSettings = () => {
    const state = window.history.state as { readerSettings?: boolean } | null;
    if (state?.readerSettings) {
      window.history.back();
      return;
    }
    setSettingsOpen(false);
  };

  if (chapterError) return <ReaderErrorPage message={chapterError} storyId={storyId} />;
  if (!story || !chapter) return <LoadingPage label="Đang mở chương..." fullScreen />;

  return (
    <main className={`mx-auto min-h-screen w-full max-w-[480px] md:max-w-none ${bgClass} ${readerIsDark ? 'text-[#F7FAFC]' : 'text-[#111827]'}`}>
      <header
        className={`fixed inset-x-0 top-0 z-30 mx-auto w-full max-w-[480px] border-b border-black/5 px-4 pt-[calc(10px+env(safe-area-inset-top))] backdrop-blur-xl transition-transform duration-200 md:max-w-none md:px-8 ${
          uiVisible ? 'translate-y-0' : '-translate-y-full'
        } ${readerIsDark ? 'border-white/10 bg-[#101828]/92 text-white' : 'bg-white/86 text-app-text'}`}
      >
        <div className="flex min-h-14 items-center gap-3">
          <IconButton
            label="Quay lại"
            onClick={() => navigate(`/story/${storyId}`)}
            className={`h-10 w-10 shadow-none ${readerIsDark ? '!border-white/10 !bg-white/10 !text-white' : ''}`}
          >
            <ArrowLeft size={20} />
          </IconButton>
          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[15px] font-semibold">{story.title}</p>
            <p className="text-[12px] font-medium opacity-60">Chương {chapter.number}</p>
          </div>
          <button
            type="button"
            aria-label="Đánh dấu"
            className={`grid h-10 w-10 place-items-center rounded-full active:scale-[0.96] ${readerIsDark ? 'text-white' : 'text-app-text'}`}
          >
            <Bookmark size={20} />
          </button>
          <button
            type="button"
            aria-label="Tùy chọn"
            className={`grid h-10 w-10 place-items-center rounded-full active:scale-[0.96] ${readerIsDark ? 'text-white' : 'text-app-text'}`}
          >
            <Menu size={20} />
          </button>
        </div>
      </header>

      <article
        onClick={() => settings.hideUI && setUiVisible((value) => !value)}
        className={`px-6 pb-[calc(160px+env(safe-area-inset-bottom))] pt-[calc(90px+env(safe-area-inset-top))] text-justify md:px-12 md:pb-[calc(180px+env(safe-area-inset-bottom))] ${fontClass}`}
        style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight }}
      >
        {chapter.imageUrl && (
          <figure className="relative left-1/2 mb-7 w-screen max-w-none -translate-x-1/2">
            <img src={chapter.imageUrl} alt={chapter.imageCaption || chapter.title} className="h-[270px] w-full object-cover md:h-[430px]" loading="eager" />
            {chapter.imageCaption && (
              <figcaption className="mt-2 px-6 text-center text-[0.78em] font-medium opacity-60 md:px-12">{chapter.imageCaption}</figcaption>
            )}
          </figure>
        )}
        <h1 className="mb-7 text-[1.36em] font-semibold leading-tight">{chapter.title}</h1>
        <div className="space-y-6">
          {blocks.map((block, index) => {
            if (block.type === 'image') {
              return (
                <TriggeredImage
                  key={`${block.src}-${index}`}
                  triggerId={`${storyId}:${chapterNumber}:${index}:${block.src}`}
                  src={block.src}
                  alt={block.alt}
                  effect={block.effect}
                />
              );
            }

            const dialogueClass = block.type === 'dialogue' && settings.dialogueColors ? 'reader-dialogue' : '';
            return (
              <p
                key={`${block.text.slice(0, 20)}-${index}`}
                className={`leading-[inherit] ${dialogueClass}`}
                style={block.color && settings.dialogueColors ? ({ '--speaker-color': block.color } as CSSProperties) : undefined}
              >
                {block.text}
              </p>
            );
          })}
        </div>
        {showNextChapter && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              navigate(`/read/${storyId}/${nextChapter.number}`);
              window.scrollTo({ top: 0 });
            }}
            className="mb-8 mt-10 min-h-14 w-full rounded-button bg-app-primary text-[17px] font-semibold text-white shadow-soft active:scale-[0.98]"
          >
            Chương tiếp theo
          </button>
        )}
      </article>

      <button
        type="button"
        onClick={openReaderSettings}
        className={`fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-[max(18px,calc((100vw-480px)/2+18px))] z-30 grid h-12 w-12 place-items-center rounded-full bg-white text-[17px] font-semibold text-app-primaryDark shadow-float transition active:scale-[0.96] ${
          showNextChapter || (!uiVisible && !settingsOpen) ? 'pointer-events-none translate-y-3 opacity-0' : 'opacity-100'
        }`}
      >
        Aa
      </button>

      <ReaderProgressFooter percent={scrollPercent} visible={uiVisible && !showNextChapter} background={effectiveBackground} />
      <ReaderSettingsSheet open={settingsOpen} onClose={closeReaderSettings} />
    </main>
  );
}

function TriggeredImage({ triggerId, src, alt, effect = 'none' }: { triggerId: string; src: string; alt: string; effect?: string }) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [triggered, setTriggered] = useState(false);
  const normalizedEffect = effect || 'none';

  useEffect(() => {
    const image = ref.current;
    if (!image || hasStoredFlag(triggeredImageKey, triggerId)) return undefined;
    let timeout = 0;
    let hasTriggered = false;

    const runTrigger = () => {
      if (hasTriggered || hasStoredFlag(triggeredImageKey, triggerId)) return;
      hasTriggered = true;
      addStoredFlag(triggeredImageKey, triggerId);
      window.clearTimeout(timeout);
      setTriggered(true);
      timeout = window.setTimeout(() => setTriggered(false), 1100);
    };

    const checkEdge = () => {
      if (normalizedEffect === 'none') return;
      const rect = image.getBoundingClientRect();
      const topEdge = 24;
      const imageVisible = rect.bottom > 0 && rect.top < window.innerHeight;

      if (!hasTriggered && imageVisible && rect.top <= topEdge && rect.top >= -topEdge) {
        runTrigger();
      }
    };

    let frame = 0;
    const onScroll = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(checkEdge);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    checkEdge();

    return () => {
      window.clearTimeout(timeout);
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [normalizedEffect, triggerId]);

  return (
    <figure className="reader-image-wrap">
      <img ref={ref} src={src} alt={alt} loading="lazy" className={`reader-image reader-image--${normalizedEffect} ${triggered ? 'is-triggered' : ''}`} />
      {alt && <figcaption>{alt}</figcaption>}
    </figure>
  );
}

function ReaderProgressFooter({
  percent,
  visible,
  background,
}: {
  percent: number;
  visible: boolean;
  background: ReaderSettings['background'];
}) {
  return (
    <footer
      className={`fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[480px] border-t border-black/5 px-5 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl transition-transform duration-200 md:max-w-none md:px-10 ${
        visible ? 'translate-y-0' : 'translate-y-full'
      } ${background === 'dark' ? 'bg-[#101828]/90 text-white' : 'bg-white/86 text-app-text'}`}
    >
      <div className="h-1.5 rounded-full bg-black/10">
        <div className="h-1.5 rounded-full bg-app-primary" style={{ width: `${percent}%` }} />
      </div>
    </footer>
  );
}

function ReaderSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useLibraryStore((state) => state.settings);
  const setSettings = useLibraryStore((state) => state.setSettings);
  if (!open) return null;

  return (
    <BottomSheet title="Cài đặt đọc" onClose={onClose}>
      <div className="space-y-5">
        <SettingSlider
          label="Kích thước chữ"
          value={settings.fontSize}
          min={18}
          max={28}
          step={1}
          onChange={(fontSize) => setSettings({ fontSize })}
        />
        <SegmentedControl
          label="Phông chữ"
          value={settings.fontFamily}
          options={[
            ['default', 'Mặc định'],
            ['serif', 'Serif'],
            ['sans', 'Sans'],
          ]}
          onChange={(fontFamily) => setSettings({ fontFamily: fontFamily as ReaderSettings['fontFamily'] })}
        />
        <SegmentedControl
          label="Màu nền"
          value={settings.background}
          options={[
            ['white', 'White'],
            ['cream', 'Cream'],
            ['green', 'Green'],
            ['dark', 'Dark'],
          ]}
          onChange={(background) => setSettings({ background: background as ReaderSettings['background'] })}
        />
        <SettingSlider
          label="Giãn dòng"
          value={settings.lineHeight}
          min={1.6}
          max={2}
          step={0.02}
          onChange={(lineHeight) => setSettings({ lineHeight })}
        />
        <ToggleRow
          title="Dark mode"
          description="Đổi giao diện app sang nền tối"
          checked={settings.darkMode}
          onChange={() => setSettings({ darkMode: !settings.darkMode })}
        />
        <ToggleRow
          title="Màu thoại nhân vật"
          description="Bật/tắt màu riêng cho lời thoại"
          checked={settings.dialogueColors}
          onChange={() => setSettings({ dialogueColors: !settings.dialogueColors })}
        />
        <button
          type="button"
          onClick={() => setSettings({ hideUI: !settings.hideUI })}
          className="flex min-h-16 w-full items-center justify-between gap-3 rounded-card bg-app-primarySoft px-4 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold">Ẩn UI</span>
            <span className="mt-0.5 block text-[13px] font-semibold leading-snug text-app-muted">Ẩn thanh trên/dưới khi đọc</span>
          </span>
          <span className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition ${settings.hideUI ? 'bg-app-primary' : 'bg-app-border'}`}>
            <span className={`h-6 w-6 rounded-full bg-white transition ${settings.hideUI ? 'translate-x-6' : 'translate-x-0'}`} />
          </span>
        </button>
      </div>
    </BottomSheet>
  );
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className="flex min-h-16 w-full items-center justify-between gap-3 rounded-card bg-app-primarySoft px-4 text-left"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-semibold">{title}</span>
        {description && <span className="mt-0.5 block text-[13px] font-semibold leading-snug text-app-muted">{description}</span>}
      </span>
      <span className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition ${checked ? 'bg-app-primary' : 'bg-app-border'}`}>
        <span className={`h-6 w-6 rounded-full bg-white transition ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
      </span>
    </button>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card bg-white p-4 shadow-soft">
      <h2 className="mb-3 text-[20px] font-semibold">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function SettingSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[15px] font-semibold">{label}</p>
        <p className="text-[14px] font-medium text-app-muted">{Number.isInteger(value) ? value : value.toFixed(2)}</p>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onChange(clamp(value - step, min, max))} className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-soft">
          <Minus size={18} />
        </button>
        <input className="accent-app-primary" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <button type="button" onClick={() => onChange(clamp(value + step, min, max))} className="grid h-11 w-11 place-items-center rounded-full bg-white shadow-soft">
          <Plus size={18} />
        </button>
      </div>
    </div>
  );
}

function SegmentedControl({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <p className="mb-3 text-[15px] font-semibold">{label}</p>
      <div className="grid grid-cols-3 gap-2 rounded-[20px] bg-app-bg p-1">
        {options.map(([optionValue, labelText]) => (
          <button
            key={optionValue}
            type="button"
            onClick={() => onChange(optionValue)}
            className={`min-h-11 rounded-2xl text-[14px] font-semibold transition ${
              value === optionValue ? 'bg-white text-app-primaryDark shadow-soft' : 'text-app-muted'
            }`}
          >
            {labelText}
          </button>
        ))}
      </div>
    </div>
  );
}

function MePage() {
  const { stories } = useStories();
  const user = useLibraryStore((state) => state.user);
  const updateUser = useLibraryStore((state) => state.updateUser);
  const stats = useLibraryStore((state) => state.stats);
  const progress = useLibraryStore((state) => state.progress);
  const settings = useLibraryStore((state) => state.settings);
  const setSettings = useLibraryStore((state) => state.setSettings);
  const logout = useLibraryStore((state) => state.logout);
  const [accountOpen, setAccountOpen] = useState(false);
  const [updateNotice, setUpdateNotice] = useState('');
  const [updateApkUrl, setUpdateApkUrl] = useState('');
  const recent = Object.values(progress).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  useEffect(() => {
    getDeviceProfile().then((profile) => {
      const info = {
        userId: user?.id || '',
        username: user?.username || '',
        physicalDevice: profile.physicalDevice,
        installedFlavor: profile.installedFlavor,
        packageName: profile.packageName,
        versionName: profile.versionName,
        checkedAt: now(),
      };
      storage.setDeviceInfo(info);
    });
  }, [user?.id, user?.username]);

  if (!user) return null;

  const syncGithubNow = async () => {
    setUpdateNotice('Đang kiểm tra cập nhật...');
    setUpdateApkUrl('');
    try {
      const result = await api.syncRemote(officialUpdateUrl);
      if (result.appUpdate) {
        const profile = await getDeviceProfile();
        const info = {
          userId: user.id,
          username: user.username,
          physicalDevice: profile.physicalDevice,
          installedFlavor: profile.installedFlavor,
          packageName: profile.packageName,
          versionName: profile.versionName,
          checkedAt: now(),
        };
        storage.setDeviceInfo(info);
        const account = storage.getAccount(user.id);
        const allowedDevices = account?.devices?.length ? account.devices : ['any'];
        if (!allowedDevices.includes('any') && !allowedDevices.includes(profile.installedFlavor)) {
          setUpdateApkUrl('');
          setUpdateNotice('Không có bản cập nhật phù hợp.');
          return;
        }
        const selectedUrl =
          profile.installedFlavor === 'tablet'
            ? result.appUpdate.tabletApkUrl || result.appUpdate.phoneApkUrl || ''
            : result.appUpdate.phoneApkUrl || result.appUpdate.tabletApkUrl || '';
        setUpdateApkUrl(selectedUrl);
        setUpdateNotice('Có bản mới.');
        return;
      }
      setUpdateNotice(result.dataUpdated ? 'Đã cập nhật truyện.' : 'Đang là bản mới nhất.');
    } catch (error) {
      setUpdateNotice(error instanceof Error ? `Không cập nhật được: ${error.message}` : 'Không cập nhật được.');
    }
  };
  const downloadUpdateApk = async () => {
    if (!updateApkUrl) return;
    setUpdateNotice('Đang tải APK. Tải xong Android sẽ hỏi xác nhận cập nhật...');
    try {
      const result = await downloadApk(updateApkUrl);
      setUpdateNotice(`Đang tải ${result.filename}. Khi tải xong, chọn Cập nhật để cài.`);
    } catch (error) {
      setUpdateNotice(error instanceof Error ? `Không tải được APK: ${error.message}` : 'Không tải được APK.');
    }
  };

  return (
    <section className="space-y-5 px-5 pb-8 pt-[calc(22px+env(safe-area-inset-top))] md:px-8">
      <div className="flex items-center justify-between">
        <h1 className="text-[30px] font-semibold">Tài khoản</h1>
        <IconButton label="Cài đặt">
          <Settings size={20} />
        </IconButton>
      </div>

      <section className="rounded-[28px] bg-white p-5 shadow-soft">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setAccountOpen(true)}
            className="grid h-16 w-16 place-items-center rounded-full bg-app-primarySoft text-app-primaryDark active:scale-[0.96]"
            aria-label="Quản lý tài khoản"
          >
            <UserRound size={30} />
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-[22px] font-semibold">{user.name}</h2>
            <p className="truncate text-[14px] font-medium text-app-muted">{user.email}</p>
            <p className="mt-1 text-[15px] font-medium text-app-primaryDark">Chào mừng trở lại!</p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <MiniStat value={`${Math.round(stats.totalMinutesRead / 60)}`} label="giờ" />
          <MiniStat value={`${Math.max(stats.readStoryIds.length, recent.length)}`} label="truyện" />
          <MiniStat value={`${stats.streakDays}`} label="ngày liền" />
        </div>
      </section>

      <section className="rounded-card bg-white p-5 shadow-soft">
        <h2 className="mb-4 text-[21px] font-semibold">Thời gian đã đọc</h2>
        <div className="space-y-3">
          <StatRow label="Hôm nay" value={formatMinutes(stats.todayMinutesRead)} />
          <StatRow label="Tuần này" value={formatMinutes(stats.weekMinutesRead)} />
          <StatRow label="Tháng này" value={formatMinutes(stats.monthMinutesRead)} />
        </div>
      </section>

      <section className="rounded-card bg-white p-4 shadow-soft">
        <h2 className="mb-3 text-[21px] font-semibold">Đọc gần đây</h2>
        {recent.length ? (
          <div className="divide-y divide-app-border">
            {recent.slice(0, 5).map((item) => {
              const story = stories.find((entry) => entry.id === item.storyId);
              if (!story) return null;
              return <RecentRow key={item.storyId} story={story} chapterNumber={item.chapterNumber} updatedAt={item.updatedAt} />;
            })}
          </div>
        ) : (
          <EmptyCard text="Bạn chưa đọc truyện nào trong phiên này." />
        )}
      </section>

      <section className="space-y-3">
        <SettingsGroup title="Giao diện app">
          <ToggleRow title="Dark mode" description="Đổi toàn bộ app sang nền tối" checked={settings.darkMode} onChange={() => setSettings({ darkMode: !settings.darkMode })} />
        </SettingsGroup>

        <SettingsGroup title="Đọc truyện">
          <SettingsRow label="Màu nền đọc" value={settings.background} swatch={settings.background} />
          <SettingsRow label="Kích thước chữ" value={`${settings.fontSize}px`} />
          <ToggleRow title="Ẩn UI khi đọc" description="Ẩn thanh trên/dưới khi chạm trang đọc" checked={settings.hideUI} onChange={() => setSettings({ hideUI: !settings.hideUI })} />
          <ToggleRow
            title="Màu thoại nhân vật"
            description="Bật/tắt màu riêng cho lời thoại"
            checked={settings.dialogueColors}
            onChange={() => setSettings({ dialogueColors: !settings.dialogueColors })}
          />
        </SettingsGroup>

        <SettingsGroup title="Cập nhật">
          <ToggleRow title="Tự động cập nhật" description="Tự nhận truyện mới từ GitHub khi mở app" checked={settings.autoUpdate} onChange={() => setSettings({ autoUpdate: !settings.autoUpdate })} />
          <button
            type="button"
            onClick={syncGithubNow}
            className="flex min-h-[48px] w-full items-center justify-center rounded-button bg-app-primarySoft text-center text-[15px] font-semibold text-app-primaryDark"
          >
            Kiểm tra cập nhật
          </button>
          {updateNotice && <p className="text-[13px] font-semibold text-app-muted">{updateNotice}</p>}
          {updateApkUrl && (
            <button
              type="button"
              onClick={downloadUpdateApk}
              className="flex min-h-[48px] w-full items-center justify-center rounded-button border border-app-border bg-white text-center text-[15px] font-semibold shadow-soft"
            >
              Tải bản app mới
            </button>
          )}
          <SettingsRow label="Phiên bản app" value={`v${appInfo.versionName}`} />
        </SettingsGroup>
      </section>

      <div className="grid gap-3">
        <button type="button" onClick={logout} className="flex min-h-[52px] items-center justify-center rounded-button bg-white text-center text-[16px] font-semibold text-app-danger shadow-soft">
          <LogOut className="mr-2 inline" size={18} />
          Đăng xuất
        </button>
      </div>
      {accountOpen && <AccountSheet user={user} onSave={updateUser} onClose={() => setAccountOpen(false)} />}
    </section>
  );
}

function AccountSheet({ user, onSave, onClose }: { user: MockUser; onSave: (user: MockUser) => void; onClose: () => void }) {
  const [name, setName] = useState(user.name);

  return (
    <BottomSheet title="Quản lý tài khoản" onClose={onClose}>
      <div className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-[14px] font-semibold text-app-muted">Tên hiển thị</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-12 w-full rounded-button border border-app-border bg-white px-4 text-[16px] font-semibold outline-none focus:border-app-primary"
          />
        </label>
        <SettingsRow label="Tài khoản" value={user.username} />
        <SettingsRow label="Email" value={user.email} />
        <button
          type="button"
          onClick={() => {
            onSave({ ...user, name: name.trim() || user.name });
            onClose();
          }}
          className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-button bg-app-primary text-[16px] font-semibold text-white"
        >
          <Check size={19} />
          Lưu tên
        </button>
      </div>
    </BottomSheet>
  );
}

function RecentRow({ story, chapterNumber, updatedAt }: { story: Story; chapterNumber: number; updatedAt: string }) {
  return (
    <button type="button" onClick={() => navigate(`/read/${story.id}/${chapterNumber}`)} className="flex min-h-[78px] w-full items-center gap-3 py-3 text-left">
      <Cover story={story} className="h-14 w-11 rounded-2xl" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[16px] font-semibold">{story.title}</span>
        <span className="mt-0.5 block text-[14px] font-medium text-app-muted">Chương {chapterNumber}</span>
        <span className="mt-0.5 block text-[12px] font-semibold text-app-muted">Đọc lần cuối: {formatDateTime(updatedAt)}</span>
      </span>
      <ChevronRight size={19} className="text-app-muted" />
    </button>
  );
}

type AudioStory = {
  story: Pick<Story, 'id' | 'title' | 'coverUrl' | 'totalChapters'>;
  chapters: AudioChapter[];
};

function audioManifestUrlFromUpdateUrl(updateUrl: string) {
  try {
    const url = new URL(updateUrl);
    if (url.hostname === 'api.github.com' && url.pathname.includes('/contents/')) {
      const parts = url.pathname.split('/').filter(Boolean);
      const owner = parts[1];
      const repo = parts[2];
      const branch = url.searchParams.get('ref') || 'master';
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/public/audio/manifest.json`;
    }
  } catch {
    // Keep the bundled manifest as fallback if the update URL is custom or malformed.
  }
  return '/audio/manifest.json';
}

function normalizeAudioManifest(data: unknown, manifestUrl: string): AudioStory[] {
  const stories = (data as { stories?: AudioStory[] })?.stories;
  if (!Array.isArray(stories)) return [];
  const publicBase = manifestUrl.startsWith('http') ? manifestUrl.replace(/\/audio\/manifest\.json(?:\?.*)?$/, '') : '';

  return stories
    .filter((item) => item?.story?.id && Array.isArray(item.chapters))
    .map((item) => ({
      story: item.story,
      chapters: item.chapters.map((chapter) => ({
        ...chapter,
        audioUrl:
          publicBase && chapter.audioUrl && !/^https?:\/\//i.test(chapter.audioUrl)
            ? `${publicBase}/${chapter.audioUrl.replace(/^\/+/, '')}`
            : chapter.audioUrl,
      })),
    }));
}

function formatAudioTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00';
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function AudioPage() {
  const { stories } = useStories();
  const [audioStories, setAudioStories] = useState<AudioStory[]>([]);
  const [selectedStoryId, setSelectedStoryId] = useState('');
  const [selectedChapterNumber, setSelectedChapterNumber] = useState(0);

  useEffect(() => {
    let mounted = true;
    const remoteManifestUrl = audioManifestUrlFromUpdateUrl(officialUpdateUrl);
    const loadManifest = async () => {
      for (const manifestUrl of [remoteManifestUrl, '/audio/manifest.json']) {
        try {
          const response = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
          if (!response.ok) continue;
          const list = normalizeAudioManifest(await response.json(), manifestUrl);
          if (!list.length) continue;
          if (!mounted) return;
          setAudioStories(list);
          setSelectedStoryId((current) => current || list[0]?.story?.id || '');
          return;
        } catch {
          // Try the next source.
        }
      }
      if (mounted) setAudioStories([]);
    };
    void loadManifest();
    return () => {
      mounted = false;
    };
  }, []);

  const visibleAudioStories = audioStories.length
    ? audioStories
    : stories.map((story) => ({ story: { id: story.id, title: story.title, coverUrl: story.coverUrl, totalChapters: 0 }, chapters: [] }));
  const effectiveSelectedStoryId = selectedStoryId || visibleAudioStories[0]?.story.id || '';
  const selectedAudioStory = visibleAudioStories.find((item) => item.story.id === effectiveSelectedStoryId);
  const selectedChapter =
    selectedAudioStory?.chapters.find((chapter) => chapter.chapterNumber === selectedChapterNumber) || selectedAudioStory?.chapters[0] || null;

  useEffect(() => {
    if (!selectedAudioStory?.chapters.length) {
      setSelectedChapterNumber(0);
      return;
    }
    setSelectedChapterNumber((current) =>
      selectedAudioStory.chapters.some((chapter) => chapter.chapterNumber === current) ? current : selectedAudioStory.chapters[0].chapterNumber,
    );
  }, [selectedAudioStory?.story.id, selectedAudioStory?.chapters]);

  const selectedChapterIndex = selectedAudioStory?.chapters.findIndex((chapter) => chapter.chapterNumber === selectedChapter?.chapterNumber) ?? -1;
  const previousChapter = selectedAudioStory && selectedChapterIndex > 0 ? selectedAudioStory.chapters[selectedChapterIndex - 1] : null;
  const nextChapter =
    selectedAudioStory && selectedChapterIndex >= 0 && selectedChapterIndex < selectedAudioStory.chapters.length - 1
      ? selectedAudioStory.chapters[selectedChapterIndex + 1]
      : null;

  return (
    <section className="space-y-5 px-5 pb-8 pt-[calc(22px+env(safe-area-inset-top))] md:px-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-semibold">Audio Book</h1>
          <p className="mt-1 text-[15px] font-medium text-app-muted">Chuyên mục nghe truyện</p>
        </div>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-app-primarySoft text-app-primaryDark">
          <Headphones size={23} />
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-hide">
        {visibleAudioStories.map(({ story, chapters }) => (
          <button
            type="button"
            key={story.id}
            onClick={() => {
              setSelectedStoryId(story.id);
              setSelectedChapterNumber(0);
            }}
            className={`w-[210px] shrink-0 rounded-card p-3 text-left shadow-soft active:scale-[0.99] ${
              effectiveSelectedStoryId === story.id ? 'bg-app-primarySoft text-app-primaryDark' : 'bg-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <Cover story={story as Story} className="h-16 w-12 rounded-2xl" />
              <span className="min-w-0">
                <span className="block truncate text-[16px] font-semibold">{story.title}</span>
                <span className="mt-1 block text-[13px] font-semibold opacity-70">{chapters.length ? `${chapters.length} audio` : 'Chưa có audio'}</span>
              </span>
            </div>
          </button>
        ))}
      </div>

      <section className="rounded-card bg-white p-4 shadow-soft">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[21px] font-semibold">{selectedAudioStory?.story.title || 'Chưa có audio'}</h2>
            <p className="mt-1 text-[14px] font-medium text-app-muted">Chọn chương để nghe</p>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-full bg-app-primarySoft text-app-primaryDark">
            <Headphones size={20} />
          </span>
        </div>

        {selectedAudioStory?.chapters.length ? (
          <div className="space-y-4">
            <div className="space-y-2">
              {selectedAudioStory.chapters.map((chapter) => (
                <button
                  type="button"
                  key={`${chapter.storyId}-${chapter.chapterNumber}`}
                  onClick={() => setSelectedChapterNumber(chapter.chapterNumber)}
                  className={`flex min-h-[68px] w-full items-center gap-3 rounded-[20px] border p-3 text-left active:scale-[0.99] ${
                    selectedChapter?.chapterNumber === chapter.chapterNumber
                      ? 'border-app-primary bg-app-primarySoft text-app-primaryDark'
                      : 'border-app-border bg-app-bg'
                  }`}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[13px] font-semibold shadow-soft">
                    {String(chapter.chapterNumber).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16px] font-semibold">{chapter.title}</span>
                    <span className="mt-0.5 block text-[12px] font-semibold opacity-70">{chapter.filename}</span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 opacity-70" />
                </button>
              ))}
            </div>

            {selectedChapter && (
              <AudioChapterPlayer
                key={`${selectedChapter.storyId}-${selectedChapter.chapterNumber}`}
                story={selectedAudioStory.story}
                chapter={selectedChapter}
                previousChapter={previousChapter}
                nextChapter={nextChapter}
                onPrevious={() => previousChapter && setSelectedChapterNumber(previousChapter.chapterNumber)}
                onNext={() => nextChapter && setSelectedChapterNumber(nextChapter.chapterNumber)}
              />
            )}

            {selectedChapter && (
              <button
                type="button"
                onClick={() => navigate(`/read/${selectedChapter.storyId}/${selectedChapter.chapterNumber}`)}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-button bg-white text-[14px] font-semibold text-app-muted shadow-soft"
              >
                <BookOpen size={17} />
                Mở bản chữ
              </button>
            )}
          </div>
        ) : (
          <EmptyCard text="Chưa tìm thấy file audio cho truyện này." />
        )}
      </section>
    </section>
  );
}

function AudioChapterPlayer({
  story,
  chapter,
  previousChapter,
  nextChapter,
  onPrevious,
  onNext,
}: {
  story: Pick<Story, 'id' | 'title' | 'coverUrl' | 'totalChapters'>;
  chapter: AudioChapter;
  previousChapter: AudioChapter | null;
  nextChapter: AudioChapter | null;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const speedOptions = [0.75, 1, 1.25, 1.5, 2];

  const seekBy = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clamp(audio.currentTime + seconds, 0, audio.duration || 0);
    setCurrentTime(audio.currentTime);
  };

  const seekTo = (value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = clamp(value, 0, audio.duration || 0);
    setCurrentTime(audio.currentTime);
  };

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      await audio.play();
    } else {
      audio.pause();
    }
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const syncTime = () => setCurrentTime(audio.currentTime || 0);
    const syncDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const syncPlaying = () => setPlaying(!audio.paused);
    const handleEnded = () => {
      setPlaying(false);
      if (nextChapter) onNext();
    };

    audio.addEventListener('timeupdate', syncTime);
    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('play', syncPlaying);
    audio.addEventListener('pause', syncPlaying);
    audio.addEventListener('ended', handleEnded);
    syncDuration();
    syncTime();
    syncPlaying();

    return () => {
      audio.removeEventListener('timeupdate', syncTime);
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('durationchange', syncDuration);
      audio.removeEventListener('play', syncPlaying);
      audio.removeEventListener('pause', syncPlaying);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [chapter.audioUrl, nextChapter, onNext]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapter.title,
      artist: story.title,
      album: 'Leaf Novel',
      artwork: story.coverUrl ? [{ src: story.coverUrl, sizes: '512x512', type: 'image/png' }] : undefined,
    });

    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some Android WebView versions do not expose every media action.
      }
    };

    setHandler('play', () => void audioRef.current?.play());
    setHandler('pause', () => audioRef.current?.pause());
    setHandler('seekbackward', () => seekBy(-15));
    setHandler('seekforward', () => seekBy(15));
    setHandler('previoustrack', previousChapter ? onPrevious : null);
    setHandler('nexttrack', nextChapter ? onNext : null);
    setHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') seekTo(details.seekTime);
    });

    return () => {
      setHandler('play', null);
      setHandler('pause', null);
      setHandler('seekbackward', null);
      setHandler('seekforward', null);
      setHandler('previoustrack', null);
      setHandler('nexttrack', null);
      setHandler('seekto', null);
    };
  }, [chapter.title, story.title, story.coverUrl, previousChapter, nextChapter, onPrevious, onNext]);

  return (
    <article className="rounded-card bg-app-bg p-4">
      <audio ref={audioRef} src={chapter.audioUrl} preload="metadata" />
      <div className="mb-4 flex items-center gap-3">
        <div className={`audio-disc h-20 w-20 shrink-0 ${playing ? 'is-playing' : ''}`}>
          <Cover story={story as Story} className="h-full w-full rounded-full" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-app-muted">Đang nghe</p>
          <h3 className="mt-1 line-clamp-2 text-[18px] font-semibold leading-tight">{chapter.title}</h3>
          <p className="mt-1 truncate text-[13px] font-semibold text-app-muted">{story.title}</p>
        </div>
      </div>

      <div className="space-y-2">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={Math.min(currentTime, duration || currentTime)}
          onChange={(event) => seekTo(Number(event.target.value))}
          className="h-2 w-full accent-app-primary"
          aria-label="Tua audio"
        />
        <div className="flex items-center justify-between text-[12px] font-semibold text-app-muted">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(duration)}</span>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!previousChapter}
          className="grid h-11 w-11 place-items-center rounded-full bg-white text-app-muted shadow-soft disabled:opacity-35"
          aria-label="Chương trước"
        >
          <SkipBack size={20} />
        </button>
        <button type="button" onClick={() => seekBy(-15)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-app-muted shadow-soft" aria-label="Tua lùi 15 giây">
          <Rewind size={19} />
        </button>
        <button type="button" onClick={() => void togglePlay()} className="grid h-14 w-14 place-items-center rounded-full bg-app-primary text-white shadow-soft" aria-label="Phát hoặc tạm dừng">
          {playing ? <Pause size={25} /> : <Play size={25} />}
        </button>
        <button type="button" onClick={() => seekBy(15)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-app-muted shadow-soft" aria-label="Tua tới 15 giây">
          <SkipForward size={19} />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!nextChapter}
          className="grid h-11 w-11 place-items-center rounded-full bg-white text-app-muted shadow-soft disabled:opacity-35"
          aria-label="Chương sau"
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-5 gap-2">
        {speedOptions.map((speed) => (
          <button
            type="button"
            key={speed}
            onClick={() => setPlaybackRate(speed)}
            className={`min-h-10 rounded-full text-[13px] font-semibold ${
              playbackRate === speed ? 'bg-app-primary text-white' : 'bg-white text-app-muted'
            }`}
          >
            {speed}x
          </button>
        ))}
      </div>

      {playing && (
        <div className="audio-island fixed inset-x-0 top-[calc(10px+env(safe-area-inset-top))] z-[70] mx-auto flex w-[min(92vw,420px)] items-center gap-3 rounded-full bg-[#071017]/92 px-3 py-2 text-white shadow-float backdrop-blur">
          <div className="audio-disc is-playing h-10 w-10 shrink-0">
            <Cover story={story as Story} className="h-full w-full rounded-full" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold">{chapter.title}</p>
            <p className="truncate text-[11px] font-medium text-white/65">{formatAudioTime(currentTime)} / {formatAudioTime(duration)}</p>
          </div>
          <button type="button" onClick={() => void togglePlay()} className="grid h-9 w-9 place-items-center rounded-full bg-white/12" aria-label="Tạm dừng">
            <Pause size={18} />
          </button>
        </div>
      )}
    </article>
  );
}

function LibraryPage() {
  const { stories } = useStories();
  const progress = useLibraryStore((state) => state.progress);
  const items = Object.values(progress)
    .map((item) => ({ ...item, story: stories.find((story) => story.id === item.storyId) }))
    .filter((item) => item.story);
  return (
    <section className="space-y-5 px-5 pb-8 pt-[calc(22px+env(safe-area-inset-top))] md:px-8">
      <h1 className="text-[30px] font-semibold">Thư viện</h1>
      {items.length ? (
        <div className="rounded-card bg-white p-4 shadow-soft">
          {items.map((item) => (
            <RecentRow key={item.storyId} story={item.story!} chapterNumber={item.chapterNumber} updatedAt={item.updatedAt} />
          ))}
        </div>
      ) : (
        <EmptyCard text="Các truyện bạn đọc sẽ xuất hiện ở đây." />
      )}
    </section>
  );
}

function BottomSheet({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const darkMode = useLibraryStore((state) => state.settings.darkMode);

  return (
    <div className="fixed inset-0 z-50 mx-auto w-full max-w-[480px] bg-black/25 md:max-w-none" onClick={onClose}>
      <div
        className={`absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-[30px] px-5 pb-[calc(22px+env(safe-area-inset-bottom))] pt-3 shadow-float animate-slideUp md:px-8 ${darkMode ? 'dark-sheet bg-[#0B111B] text-[#F8FAFC]' : 'bg-app-bg'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-app-border" />
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-[22px] font-semibold">{title}</h2>
          <IconButton label="Đóng" onClick={onClose} className="h-10 w-10 shadow-none">
            <X size={19} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  );
}

function MiniStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[20px] bg-app-bg p-3 text-center">
      <p className="text-[21px] font-semibold">{value}</p>
      <p className="text-[12px] font-medium text-app-muted">{label}</p>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 items-center justify-between rounded-2xl bg-app-bg px-4">
      <span className="text-[15px] font-medium text-app-muted">{label}</span>
      <span className="text-[16px] font-semibold">{value}</span>
    </div>
  );
}

function SettingsRow({ label, value, swatch, icon }: { label: string; value: string; swatch?: string; icon?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between border-t border-app-border">
      <span className="flex items-center gap-2 font-medium">{icon}{label}</span>
      <span className="flex items-center gap-2 text-[14px] font-medium text-app-muted">
        {swatch && <span className={`h-5 w-5 rounded-full border border-app-border ${readerBgClass(swatch as ReaderSettings['background'])}`} />}
        {value}
      </span>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <div className="rounded-card border border-dashed border-app-border bg-white p-5 text-center text-[15px] font-medium text-app-muted">{text}</div>;
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="h-56 animate-pulse rounded-card bg-white" />
      ))}
    </div>
  );
}

function LoadingPage({ label, fullScreen = false }: { label: string; fullScreen?: boolean }) {
  return (
    <div className={`mx-auto grid ${fullScreen ? 'min-h-screen' : 'min-h-[60vh]'} w-full max-w-[480px] place-items-center bg-app-bg px-5 text-center md:max-w-none`}>
      <div>
        <img
          src="/brand/clover-icon.png"
          alt=""
          className="mx-auto mb-4 h-16 w-16 animate-spin object-contain drop-shadow-[0_10px_24px_rgba(20,184,166,0.24)]"
        />
        <p className="text-[16px] font-semibold text-app-muted">{label}</p>
      </div>
    </div>
  );
}

function ReaderErrorPage({ message, storyId }: { message: string; storyId: string }) {
  return (
    <main className="mx-auto grid min-h-screen w-full max-w-[480px] place-items-center bg-app-bg px-5 text-center md:max-w-none">
      <section className="rounded-card bg-white p-6 shadow-soft">
        <h1 className="text-[22px] font-semibold">Không mở được chương</h1>
        <p className="mt-3 text-[16px] font-medium leading-7 text-app-muted">{message}</p>
        <button
          type="button"
          onClick={() => navigate(`/story/${storyId}`)}
          className="mt-5 min-h-12 rounded-button bg-app-primary px-6 text-[16px] font-semibold text-white"
        >
          Quay lại truyện
        </button>
      </section>
    </main>
  );
}

function readerBgClass(background: ReaderSettings['background']) {
  return {
    white: 'bg-white',
    cream: 'bg-[#FFF9ED]',
    green: 'bg-[#F0FBF7]',
    dark: 'bg-[#101828]',
  }[background];
}

export default App;
