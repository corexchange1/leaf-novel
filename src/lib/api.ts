import type { Chapter, ChapterContent, Story } from '../types';
import { localLibrary } from './localLibrary';
import { mockChapterContent, mockChapters, mockStories } from './mockData';

async function request<T>(path: string, fallback: T, fallbackOnHttpError = true): Promise<T> {
  try {
    const response = await fetch(path);
    if (!response.ok) {
      const error = new Error(`Request failed: ${response.status}`);
      error.name = 'HttpError';
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (!fallbackOnHttpError && error instanceof Error && error.name === 'HttpError') throw error;
    return fallback;
  }
}

async function requestStrict<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return await response.json();
}

export const api = {
  stories: async () => localLibrary.stories(await request<Story[]>('/api/stories', mockStories)),
  story: async (id: string) => (await api.stories()).find((story) => story.id === id) ?? null,
  chapters: async (id: string) => {
    const serverChapters = await request<Chapter[]>(`/api/stories/${id}/chapters`, []);
    return localLibrary.chapters(id, serverChapters.length ? serverChapters : mockChapters(id));
  },
  chapter: async (id: string, chapterNumber: number) => {
    const localChapter = localLibrary.chapter(id, chapterNumber);
    if (localChapter) return localChapter;

    try {
      return await requestStrict<ChapterContent>(`/api/stories/${id}/chapters/${chapterNumber}`);
    } catch {
      return (await localLibrary.bundledChapter(id, chapterNumber)) ?? mockChapterContent(id, chapterNumber);
    }
  },
  importChapter: localLibrary.importChapter,
  importFiles: localLibrary.importFiles,
  importRecords: localLibrary.importRecords,
  syncRemote: localLibrary.syncRemote,
};
