import { create } from 'zustand';
import type { MockUser, ReaderSettings, ReadingProgress, ReadingStats } from '../types';
import { storage } from '../lib/storage';

type LibraryStore = {
  user: MockUser | null;
  progress: Record<string, ReadingProgress>;
  settings: ReaderSettings;
  stats: ReadingStats;
  login: (username: string, password: string) => boolean;
  updateUser: (user: MockUser) => void;
  setSettings: (settings: Partial<ReaderSettings>) => void;
  saveProgress: (progress: ReadingProgress) => void;
  addReadingMinute: (storyId: string) => void;
  logout: () => void;
};

function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function weekStamp(date = new Date()) {
  const normalized = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(normalized.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((normalized.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${normalized.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthStamp(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function daysBetween(previous: string, current: string) {
  if (!previous || !current) return 0;
  const previousTime = new Date(`${previous}T00:00:00.000Z`).getTime();
  const currentTime = new Date(`${current}T00:00:00.000Z`).getTime();
  return Math.round((currentTime - previousTime) / 86_400_000);
}

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  user: storage.getUser(),
  progress: storage.getProgressMap(),
  settings: storage.getSettings(),
  stats: storage.getStats(),
  login: (username, password) => {
    const user = storage.login(username, password);
    if (!user) return false;
    set({ user, settings: storage.getSettings(), progress: storage.getProgressMap(), stats: storage.getStats() });
    return true;
  },
  updateUser: (user) =>
    set(() => {
      storage.setUser(user);
      return { user };
    }),
  setSettings: (settings) =>
    set((state) => {
      const next = { ...state.settings, ...settings };
      storage.setSettings(next);
      return { settings: next };
    }),
  saveProgress: (progress) =>
    set((state) => {
      const next = { ...state.progress, [progress.storyId]: progress };
      storage.setProgressMap(next);
      return { progress: next };
    }),
  addReadingMinute: (storyId) =>
    set((state) => {
      const stats = get().stats;
      const now = new Date();
      const today = dayStamp(now);
      const thisWeek = weekStamp(now);
      const thisMonth = monthStamp(now);
      const newDay = stats.lastReadDate !== today;
      const dayGap = daysBetween(stats.lastReadDate, today);
      const readStoryIds = Array.from(new Set([...stats.readStoryIds, storyId]));
      const next = {
        ...stats,
        totalMinutesRead: stats.totalMinutesRead + 1,
        todayMinutesRead: (newDay ? 0 : stats.todayMinutesRead) + 1,
        weekMinutesRead: (stats.lastReadWeek === thisWeek ? stats.weekMinutesRead : 0) + 1,
        monthMinutesRead: (stats.lastReadMonth === thisMonth ? stats.monthMinutesRead : 0) + 1,
        streakDays: newDay ? (dayGap === 1 ? stats.streakDays + 1 : 1) : Math.max(stats.streakDays, 1),
        lastReadDate: today,
        lastReadWeek: thisWeek,
        lastReadMonth: thisMonth,
        readStoryIds,
      };
      storage.setStats(next);
      return { stats: next };
    }),
  logout: () =>
    set(() => {
      storage.logout();
      return { user: null, settings: storage.getSettings(), progress: storage.getProgressMap(), stats: storage.getStats() };
    }),
}));
