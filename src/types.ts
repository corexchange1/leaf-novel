export type StoryStatus = 'Đang ra' | 'Hoàn thành' | string;

export type Story = {
  id: string;
  title: string;
  status: StoryStatus;
  totalChapters: number;
  genres: string[];
  summary: string;
  description: string;
  updatedAt: string;
  coverUrl: string;
};

export type Chapter = {
  storyId: string;
  number: number;
  title: string;
  filename: string;
  contentFormat?: 'markdown' | 'html';
  imageUrl?: string;
  thumbnailUrl?: string;
};

export type ChapterContent = Chapter & {
  content: string;
};

export type ReaderSettings = {
  fontSize: number;
  fontFamily: 'default' | 'serif' | 'sans';
  background: 'white' | 'cream' | 'green' | 'dark';
  darkMode: boolean;
  hideUI: boolean;
  dialogueColors: boolean;
  lineHeight: number;
  updateUrl: string;
  autoUpdate: boolean;
};

export type ReadingProgress = {
  storyId: string;
  chapterNumber: number;
  scrollPercent: number;
  pageIndex?: number;
  updatedAt: string;
};

export type MockUser = {
  id: string;
  username: string;
  name: string;
  email: string;
  avatar?: string;
};

export type ReadingStats = {
  totalMinutesRead: number;
  todayMinutesRead: number;
  weekMinutesRead: number;
  monthMinutesRead: number;
  streakDays: number;
  lastReadDate: string;
  lastReadWeek: string;
  lastReadMonth: string;
  readStoryIds: string[];
};
