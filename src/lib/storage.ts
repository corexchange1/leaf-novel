import type { AccountRecord, DeviceUpdateInfo, MockUser, ReaderSettings, ReadingProgress, ReadingStats, SavedLogin } from '../types';

const keys = {
  user: 'leafnovel:user',
  session: 'leafnovel:session',
  progress: 'leafnovel:progress',
  settings: 'leafnovel:settings',
  stats: 'leafnovel:stats',
  accounts: 'leafnovel:accounts',
  savedLogin: 'leafnovel:saved-login',
  deviceInfo: 'leafnovel:device-info',
};

export const officialUpdateUrl =
  import.meta.env.VITE_STORY_UPDATE_URL || 'https://api.github.com/repos/corexchange1/leaf-novel/contents/public/updates/stories-index.json?ref=master';

export const officialAccountsUrl =
  import.meta.env.VITE_ACCOUNTS_URL || 'https://api.github.com/repos/corexchange1/leaf-novel/contents/public/updates/accounts.json?ref=master';

const bundledAccounts: AccountRecord[] = [
  { id: 'min', username: 'min', password: '123456', email: 'min@leafnovel.local', defaultName: 'Min', devices: ['any'] },
  { id: 'nh', username: 'nh', password: '123456', email: 'nh@leafnovel.local', defaultName: 'Nh', devices: ['any'] },
];

export const defaultReaderSettings: ReaderSettings = {
  fontSize: 22,
  fontFamily: 'default',
  background: 'white',
  darkMode: false,
  hideUI: true,
  dialogueColors: true,
  lineHeight: 1.82,
  updateUrl: officialUpdateUrl,
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

function sessionId() {
  return readStorage<string>(keys.session, '');
}

function statsKey() {
  const accountId = sessionId();
  return accountId ? `${keys.stats}:${accountId}` : keys.stats;
}

function settingsKey() {
  const accountId = sessionId();
  return accountId ? `${keys.settings}:${accountId}` : keys.settings;
}

function progressKey() {
  const accountId = sessionId();
  return accountId ? `${keys.progress}:${accountId}` : keys.progress;
}

function normalizeStats(stats: ReadingStats): ReadingStats {
  return {
    ...defaultStats,
    ...stats,
    totalMinutesRead: Number(stats.totalMinutesRead || 0),
    todayMinutesRead: Number(stats.todayMinutesRead || 0),
    weekMinutesRead: Number(stats.weekMinutesRead || 0),
    monthMinutesRead: Number(stats.monthMinutesRead || 0),
    streakDays: Number(stats.streakDays || 0),
    readStoryIds: Array.isArray(stats.readStoryIds) ? stats.readStoryIds : [],
  };
}

function getStatsForCurrentUser() {
  const accountKey = statsKey();
  const accountStats = readStorage<ReadingStats | null>(accountKey, null);
  if (accountStats) return normalizeStats(accountStats);

  const legacyStats = readStorage<ReadingStats | null>(keys.stats, null);
  if (!legacyStats) return defaultStats;

  const cameFromFakeSeed = !legacyStats.lastReadDate && Number(legacyStats.totalMinutesRead || 0) >= 7000;
  return cameFromFakeSeed ? defaultStats : normalizeStats(legacyStats);
}

function getSettingsForCurrentUser() {
  const accountKey = settingsKey();
  const accountSettings = readStorage<ReaderSettings | null>(accountKey, null);
  if (accountSettings) return { ...defaultReaderSettings, ...accountSettings, updateUrl: officialUpdateUrl };

  const legacySettings = readStorage<ReaderSettings | null>(keys.settings, null);
  if (legacySettings && accountKey !== keys.settings) {
    const migrated = { ...defaultReaderSettings, ...legacySettings, updateUrl: officialUpdateUrl };
    writeStorage(accountKey, migrated);
    return migrated;
  }

  return { ...defaultReaderSettings, updateUrl: officialUpdateUrl };
}

function getProgressForCurrentUser() {
  const accountKey = progressKey();
  const accountProgress = readStorage<Record<string, ReadingProgress> | null>(accountKey, null);
  if (accountProgress) return accountProgress;

  const legacyProgress = readStorage<Record<string, ReadingProgress> | null>(keys.progress, null);
  if (legacyProgress && accountKey !== keys.progress) {
    writeStorage(accountKey, legacyProgress);
    return legacyProgress;
  }

  return {};
}

function defaultUser(accountId: string): MockUser | null {
  const account = accountRecords().find((item) => item.id === accountId);
  if (!account) return null;
  return {
    id: account.id,
    username: account.username,
    name: account.defaultName,
    email: account.email,
    devices: account.devices,
  };
}

function accountRecords() {
  const accounts = readStorage<AccountRecord[]>(keys.accounts, []);
  return accounts.length ? accounts : bundledAccounts;
}

function accountToUser(account: AccountRecord): MockUser {
  return {
    id: account.id,
    username: account.username,
    name: account.defaultName,
    email: account.email,
    devices: account.devices,
  };
}

export async function syncAccounts(url = officialAccountsUrl) {
  try {
    const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Accounts failed: ${response.status}`);
    const data = decodeGithubContent(await response.json());
    const accounts = Array.isArray(data.accounts) ? (data.accounts as AccountRecord[]) : [];
    if (!accounts.length) throw new Error('Accounts empty');
    writeStorage(keys.accounts, accounts);
    return accounts;
  } catch {
    return accountRecords();
  }
}

function decodeGithubContent(data: unknown) {
  const content = (data as { content?: string })?.content;
  if (!content) return data as { accounts?: AccountRecord[] };
  return JSON.parse(atob(content.replace(/\s/g, ''))) as { accounts?: AccountRecord[] };
}

export const storage = {
  login: (username: string, password: string) => {
    const account = accountRecords().find((item) => item.id === username.trim() && item.password === password);
    if (!account) return null;
    const users = readStorage<Record<string, MockUser>>(keys.user, {});
    const user = users[account.id] ?? accountToUser(account);
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
  getAccount: (accountId: string) => accountRecords().find((item) => item.id === accountId) ?? null,
  getSavedLogin: () => readStorage<SavedLogin>(keys.savedLogin, { username: '', password: '', remember: false }),
  setSavedLogin: (login: SavedLogin) => {
    if (login.remember) writeStorage(keys.savedLogin, login);
    else localStorage.removeItem(keys.savedLogin);
  },
  getDeviceInfo: () => readStorage<DeviceUpdateInfo | null>(keys.deviceInfo, null),
  setDeviceInfo: (info: DeviceUpdateInfo) => writeStorage(keys.deviceInfo, info),
  getSettings: () => getSettingsForCurrentUser(),
  setSettings: (settings: ReaderSettings) => writeStorage(settingsKey(), { ...settings, updateUrl: officialUpdateUrl }),
  getStats: () => getStatsForCurrentUser(),
  setStats: (stats: ReadingStats) => writeStorage(statsKey(), stats),
  getProgressMap: () => getProgressForCurrentUser(),
  setProgressMap: (map: Record<string, ReadingProgress>) => writeStorage(progressKey(), map),
};
