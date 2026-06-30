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

export const useLibraryStore = create<LibraryStore>((set, get) => ({
  user: storage.getUser(),
  progress: storage.getProgressMap(),
  settings: storage.getSettings(),
  stats: storage.getStats(),
  login: (username, password) => {
    const user = storage.login(username, password);
    if (!user) return false;
    set({ user });
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
      const readStoryIds = Array.from(new Set([...stats.readStoryIds, storyId]));
      const next = {
        ...stats,
        totalMinutesRead: stats.totalMinutesRead + 1,
        todayMinutesRead: stats.todayMinutesRead + 1,
        weekMinutesRead: stats.weekMinutesRead + 1,
        monthMinutesRead: stats.monthMinutesRead + 1,
        readStoryIds,
      };
      storage.setStats(next);
      return { stats: next };
    }),
  logout: () =>
    set(() => {
      storage.logout();
      return { user: null, settings: storage.getSettings(), progress: storage.getProgressMap() };
    }),
}));
