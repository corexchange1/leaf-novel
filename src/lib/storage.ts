import type { MockUser, ReaderSettings, ReadingProgress, ReadingStats } from '../types';

const keys = {
  user: 'leafnovel:user',
  session: 'leafnovel:session',
  progress: 'leafnovel:progress',
  settings: 'leafnovel:settings',
  stats: 'leafnovel:stats',
};

export const officialAccounts = [
  { id: 'min', username: 'min', password: '123456', email: 'min@leafnovel.local', defaultName: 'Min' },
  { id: 'nh', username: 'nh', password: '123456', email: 'nh@leafnovel.local', defaultName: 'Nh' },
] as const;

export const defaultReaderSettings: ReaderSettings = {
  fontSize: 22,
  fontFamily: 'default',
  background: 'white',
  darkMode: false,
  hideUI: true,
  dialogueColors: true,
  lineHeight: 1.82,
  updateUrl: import.meta.env.VITE_STORY_UPDATE_URL || 'https://raw.githubusercontent.com/corexchange1/leaf-novel/master/public/updates/stories-index.json',
  autoUpdate: true,
};

export const defaultStats: ReadingStats = {
  totalMinutesRead: 0,
  todayMinutesRead: 0,
  weekMinutesRead: 0,
  monthMinutesRead: 0,
  streakDays: 0,
  lastReadDate: '',
  lastReadWeek: '',
  lastReadMonth: '',
  readStoryIds: [],
};

export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (
      fallback &&
      typeof fallback === 'object' &&
      !Array.isArray(fallback) &&
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return { ...fallback, ...parsed };
    }
    return parsed;
  } catch {
    return fallback;
  }
}

export function writeStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function defaultUser(accountId: string): MockUser | null {
  const account = officialAccounts.find((item) => item.id === accountId);
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    name: account.defaultName,
    email: account.email,
  };
}

export const storage = {
  login: (username: string, password: string) => {
    const account = officialAccounts.find((item) => item.username === username.trim() && item.password === password);
    if (!account) return null;
    const users = readStorage<Record<string, MockUser>>(keys.user, {});
    const user = users[account.id] ?? defaultUser(account.id);
    if (!user) return null;
    writeStorage(keys.session, account.id);
    writeStorage(keys.user, { ...users, [account.id]: user });
    return user;
  },
  logout: () => localStorage.removeItem(keys.session),
  getUser: () => {
    const accountId = readStorage<string>(keys.session, '');
    if (!accountId) return null;
    const users = readStorage<Record<string, MockUser>>(keys.user, {});
    return users[accountId] ?? defaultUser(accountId);
  },
  setUser: (user: MockUser) => {
    const users = readStorage<Record<string, MockUser>>(keys.user, {});
    writeStorage(keys.user, { ...users, [user.id]: user });
  },
  getSettings: () => readStorage(keys.settings, defaultReaderSettings),
  setSettings: (settings: ReaderSettings) => writeStorage(keys.settings, settings),
  getStats: () => readStorage(keys.stats, defaultStats),
  setStats: (stats: ReadingStats) => writeStorage(keys.stats, stats),
  getProgressMap: () => readStorage<Record<string, ReadingProgress>>(keys.progress, {}),
  setProgressMap: (map: Record<string, ReadingProgress>) => writeStorage(keys.progress, map),
};
