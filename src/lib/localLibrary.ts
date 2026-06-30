import type { Chapter, ChapterContent, Story } from '../types';
import JSZip from 'jszip';
import { appInfo } from './appInfo';

type BundledStory = {
  story: Story;
  chapters: ChapterContent[];
};

type LocalLibraryState = {
  stories: Record<string, Story>;
  chapters: Record<string, Record<number, ChapterContent>>;
};

type ImportRecord = {
  name: string;
  path: string;
  content?: string;
  dataUrl?: string;
  mimeType?: string;
};

const key = 'leafnovel:local-library';
const remoteKey = 'leafnovel:github-library';
const remoteMetaKey = 'leafnovel:github-library-meta';
let bundledPromise: Promise<BundledStory[]> | null = null;

type RemoteMeta = {
  dataVersion: string;
  updatedAt: string;
};

type UpdateIndex = {
  dataVersion?: string;
  archiveUrl?: string;
  sha256?: string;
  latestApp?: {
    versionName?: string;
    versionCode?: number;
    phoneApkUrl?: string;
    tabletApkUrl?: string;
  };
};

function blankState(): LocalLibraryState {
  return { stories: {}, chapters: {} };
}

function readState(): LocalLibraryState {
  return readLibraryState(key);
}

function readLibraryState(storageKey: string): LocalLibraryState {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? { ...blankState(), ...JSON.parse(raw) } : blankState();
  } catch {
    return blankState();
  }
}

function writeState(state: LocalLibraryState, storageKey = key) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function readRemoteMeta(): RemoteMeta {
  try {
    const raw = localStorage.getItem(remoteMetaKey);
    return raw ? { dataVersion: '', updatedAt: '', ...JSON.parse(raw) } : { dataVersion: '', updatedAt: '' };
  } catch {
    return { dataVersion: '', updatedAt: '' };
  }
}

function writeRemoteMeta(meta: RemoteMeta) {
  localStorage.setItem(remoteMetaKey, JSON.stringify(meta));
}

function mergeStories(base: Story[], imported: Story[]) {
  const map = new Map<string, Story>();
  for (const story of base) map.set(story.id, story);
  for (const story of imported) map.set(story.id, { ...map.get(story.id), ...story });
  return Array.from(map.values()).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function mergeChapters(base: Chapter[], imported: Chapter[]) {
  const map = new Map<number, Chapter>();
  for (const chapter of base) map.set(chapter.number, chapter);
  for (const chapter of imported) map.set(chapter.number, chapter);
  return Array.from(map.values()).sort((a, b) => a.number - b.number);
}

async function bundledStories() {
  if (!bundledPromise) {
    bundledPromise = fetch('/bundled-stories/manifest.json')
      .then((response) => (response.ok ? response.json() : { stories: [] }))
      .then((data) => (Array.isArray(data.stories) ? (data.stories as BundledStory[]) : []))
      .catch(() => []);
  }
  return bundledPromise;
}

function localStories() {
  return Object.values(readState().stories);
}

function remoteState() {
  return readLibraryState(remoteKey);
}

function remoteStories() {
  return Object.values(remoteState().stories);
}

function localChapters(storyId: string): ChapterContent[] {
  return Object.values(readState().chapters[storyId] ?? {});
}

function remoteChapters(storyId: string): ChapterContent[] {
  return Object.values(remoteState().chapters[storyId] ?? {});
}

function supportedFile(file: File) {
  return supportedChapterName(file.name) || supportedImageName(file.name);
}

function supportedChapterName(value: string) {
  const name = value.toLowerCase();
  return name.endsWith('.md') || name.endsWith('.html') || name.endsWith('.htm');
}

function supportedImageName(value: string) {
  const name = value.toLowerCase();
  return name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.webp');
}

function chapterFormat(filename: string): ChapterContent['contentFormat'] {
  return filename.toLowerCase().endsWith('.html') || filename.toLowerCase().endsWith('.htm') ? 'html' : 'markdown';
}

function chapterTitle(content: string, format: ChapterContent['contentFormat'], number: number) {
  const title =
    format === 'html'
      ? content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || content.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      : content.match(/^#\s+(.+)$/m)?.[1];
  return title?.replace(/<[^>]+>/g, '').trim() || `Chương ${String(number).padStart(3, '0')}`;
}

function importedChapterNumber(filename: string, existing: Chapter[]) {
  const fromName = Number.parseInt(filename, 10);
  if (Number.isFinite(fromName) && fromName > 0) return fromName;
  const embedded = filename.match(/(?:^|[^0-9])0*(\d{1,4})(?:[^0-9]|$)/)?.[1];
  if (embedded) return Number.parseInt(embedded, 10);
  return Math.max(0, ...existing.map((chapter) => chapter.number)) + 1;
}

function slugify(value: string) {
  return (
    value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'truyen-tai-len'
  );
}

function filePath(file: File) {
  return file.webkitRelativePath || file.name;
}

function folderName(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 1 ? parts[0] : 'Truyện tải lên';
}

function fileStem(path: string) {
  return path
    .split('/')
    .pop()
    ?.replace(/\.[^.]+$/, '')
    .toLocaleLowerCase('vi-VN') ?? '';
}

function parentPath(path: string) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/').toLocaleLowerCase('vi-VN');
}

function companionKey(path: string) {
  return `${parentPath(path)}/${fileStem(path)}`;
}

function publicBaseFromManifest(updateUrl: string) {
  const url = new URL(updateUrl);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/bundled-stories\/manifest\.json$/, '');
  return url.toString().replace(/\/$/, '');
}

function absoluteUrl(value: string, baseUrl: string) {
  return new URL(value, baseUrl).toString();
}

function resolveRemoteAsset(value: string | undefined, publicBase: string) {
  if (!value) return '';
  if (/^data:|^https?:\/\//i.test(value)) return value;
  return `${publicBase}/${value.replace(/^\/+/, '')}`;
}

function normalizeRemoteStories(data: unknown, updateUrl: string): BundledStory[] {
  const stories = (data as { stories?: BundledStory[] })?.stories;
  if (!Array.isArray(stories)) return [];
  const publicBase = publicBaseFromManifest(updateUrl);
  return stories
    .filter((item) => item?.story?.id && Array.isArray(item.chapters))
    .map((item) => ({
      story: {
        ...item.story,
        coverUrl: resolveRemoteAsset(item.story.coverUrl, publicBase),
      },
      chapters: item.chapters.map((chapter) => ({
        ...chapter,
        imageUrl: resolveRemoteAsset(chapter.imageUrl, publicBase) || chapter.imageUrl,
      })),
    }));
}

function mimeFromPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function dataUrlFromZip(zip: JSZip, path: string | undefined) {
  if (!path) return '';
  const file = zip.file(path.replace(/^\/+/, ''));
  if (!file) return '';
  const bytes = await file.async('uint8array');
  return `data:${mimeFromPath(path)};base64,${bytesToBase64(bytes)}`;
}

function isRemoteOrDataUrl(src: string) {
  return /^(https?:|data:|blob:|\/)/i.test(src);
}

function resolveChapterAsset(chapter: ChapterContent, src?: string) {
  if (!src || isRemoteOrDataUrl(src)) return '';
  const safeSrc = src.replace(/^\.?\//, '');
  return `stories/${chapter.storyId}/chapters/${safeSrc}`;
}

async function rewriteInlineImages(content: string, chapter: ChapterContent, zip: JSZip) {
  const replacements = new Map<string, string>();
  const patterns = [
    /!\[[^\]]*\]\(([^)]+)\)/g,
    /\{\{\s*image\s+[^}]*src\s*=\s*["']?([^"'\s}]+)["']?[^}]*\}\}/gi,
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const src = match[1]?.trim();
      const assetPath = resolveChapterAsset(chapter, src);
      if (!src || !assetPath || replacements.has(src)) continue;
      const dataUrl = await dataUrlFromZip(zip, assetPath);
      if (dataUrl) replacements.set(src, dataUrl);
    }
  }

  let next = content;
  for (const [src, dataUrl] of replacements) {
    next = next.split(src).join(dataUrl);
  }
  return next;
}

async function storiesFromPack(buffer: ArrayBuffer): Promise<BundledStory[]> {
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) return [];
  const manifest = JSON.parse(await manifestFile.async('string')) as { stories?: BundledStory[] };
  const stories = Array.isArray(manifest.stories) ? manifest.stories : [];
  const normalized: BundledStory[] = [];

  for (const item of stories) {
    if (!item?.story?.id || !Array.isArray(item.chapters)) continue;
    normalized.push({
      story: {
        ...item.story,
        coverUrl: (await dataUrlFromZip(zip, item.story.coverUrl)) || item.story.coverUrl,
      },
      chapters: await Promise.all(
        item.chapters.map(async (chapter) => {
          const normalizedChapter = {
            ...chapter,
            imageUrl: (await dataUrlFromZip(zip, chapter.imageUrl)) || chapter.imageUrl,
          };
          return {
            ...normalizedChapter,
            content: await rewriteInlineImages(chapter.content, normalizedChapter, zip),
          };
        }),
      ),
    });
  }

  return normalized;
}

function appUpdateFromIndex(index: UpdateIndex) {
  const latestCode = Number(index.latestApp?.versionCode || 0);
  if (!latestCode || latestCode <= appInfo.versionCode) return null;
  return {
    versionName: index.latestApp?.versionName || String(latestCode),
    versionCode: latestCode,
    phoneApkUrl: index.latestApp?.phoneApkUrl || '',
    tabletApkUrl: index.latestApp?.tabletApkUrl || '',
  };
}

function writeRemoteStories(stories: BundledStory[]) {
  const state = blankState();
  let chapterCount = 0;

  for (const item of stories) {
    state.stories[item.story.id] = {
      ...item.story,
      updatedAt: item.story.updatedAt || new Date().toISOString(),
    };
    state.chapters[item.story.id] = {};
    for (const chapter of item.chapters) {
      state.chapters[item.story.id][chapter.number] = chapter;
      chapterCount += 1;
    }
  }

  writeState(state, remoteKey);
  window.dispatchEvent(new Event('leafnovel:local-library-updated'));
  return { storyCount: stories.length, chapterCount };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function fileToRecord(file: File): Promise<ImportRecord> {
  const path = filePath(file);
  if (supportedImageName(file.name)) {
    return {
      name: file.name,
      path,
      dataUrl: await fileToDataUrl(file),
      mimeType: file.type || undefined,
    };
  }
  return {
    name: file.name,
    path,
    content: (await file.text()).trim(),
  };
}

async function filesToRecords(files: File[]) {
  return Promise.all(files.filter(supportedFile).map(fileToRecord));
}

export const localLibrary = {
  async bundledStories(): Promise<Story[]> {
    return (await bundledStories()).map((item) => item.story);
  },
  async bundledChapters(storyId: string): Promise<ChapterContent[]> {
    return (await bundledStories()).find((item) => item.story.id === storyId)?.chapters ?? [];
  },
  async stories(base: Story[] = []) {
    return mergeStories(mergeStories(mergeStories(base, await this.bundledStories()), remoteStories()), localStories());
  },
  async chapters(storyId: string, base: Chapter[] = []) {
    return mergeChapters(mergeChapters(base, remoteChapters(storyId)), localChapters(storyId));
  },
  chapter(storyId: string, chapterNumber: number): ChapterContent | null {
    return readState().chapters[storyId]?.[chapterNumber] ?? remoteState().chapters[storyId]?.[chapterNumber] ?? null;
  },
  async bundledChapter(storyId: string, chapterNumber: number): Promise<ChapterContent | null> {
    return (await this.bundledChapters(storyId)).find((chapter) => chapter.number === chapterNumber) ?? null;
  },
  async importChapter(story: Story, file: File, existing: Chapter[]) {
    const content = (await file.text()).trim();
    const contentFormat = chapterFormat(file.name);
    const number = importedChapterNumber(file.name, existing);
    const chapter: ChapterContent = {
      storyId: story.id,
      number,
      title: chapterTitle(content, contentFormat, number),
      filename: file.name,
      content,
      contentFormat,
    };
    const state = readState();
    const chapters = { ...(state.chapters[story.id] ?? {}), [number]: chapter };
    const totalChapters = Math.max(story.totalChapters, ...Object.keys(chapters).map(Number), number);
    state.chapters[story.id] = chapters;
    state.stories[story.id] = {
      ...story,
      totalChapters,
      updatedAt: new Date().toISOString(),
    };
    writeState(state);
    return chapter;
  },
  async importFiles(files: File[]) {
    return this.importRecords(await filesToRecords(files));
  },
  async importRecords(records: ImportRecord[]) {
    const groups = new Map<string, ImportRecord[]>();
    const validRecords = records.filter((record) => {
      if (supportedChapterName(record.name)) return !!record.content?.trim();
      if (supportedImageName(record.name)) return !!record.dataUrl;
      return false;
    });
    for (const record of validRecords) {
      const group = folderName(record.path || record.name);
      groups.set(group, [...(groups.get(group) ?? []), record]);
    }

    const state = readState();
    let chapterCount = 0;
    for (const [title, groupRecords] of groups) {
      const storyId = slugify(title);
      const previousStory = state.stories[storyId];
      const previousChapters = Object.values(state.chapters[storyId] ?? {});
      const chapters: Record<number, ChapterContent> = { ...(state.chapters[storyId] ?? {}) };
      const imageUrls = new Map<string, string>();
      for (const record of groupRecords) {
        if (supportedImageName(record.name) && record.dataUrl) {
          imageUrls.set(companionKey(record.path || record.name), record.dataUrl);
        }
      }
      const sortedRecords = [...groupRecords]
        .filter((record) => supportedChapterName(record.name))
        .sort((a, b) => a.path.localeCompare(b.path, 'vi-VN', { numeric: true }));

      for (const record of sortedRecords) {
        const content = record.content?.trim() ?? '';
        if (!content) continue;
        const contentFormat = chapterFormat(record.name);
        const number = importedChapterNumber(record.name, [...previousChapters, ...Object.values(chapters)]);
        const imageUrl = imageUrls.get(companionKey(record.path || record.name));
        chapters[number] = {
          storyId,
          number,
          title: chapterTitle(content, contentFormat, number),
          filename: record.path || record.name,
          content,
          contentFormat,
          imageUrl,
        };
        chapterCount += 1;
      }

      if (!Object.keys(chapters).length) continue;
      state.chapters[storyId] = chapters;
      const totalChapters = Math.max(...Object.keys(chapters).map(Number));
      state.stories[storyId] = {
        id: storyId,
        title,
        status: previousStory?.status ?? 'Đang ra',
        totalChapters,
        genres: previousStory?.genres ?? ['Local'],
        summary: previousStory?.summary ?? `Truyện được tải lên từ thư mục ${title}.`,
        description: previousStory?.description ?? 'Nội dung đọc offline từ file Markdown hoặc HTML trên máy.',
        coverUrl: previousStory?.coverUrl ?? '/brand/clover-icon.png',
        updatedAt: new Date().toISOString(),
      };
    }

    writeState(state);
    window.dispatchEvent(new Event('leafnovel:local-library-updated'));
    return { storyCount: groups.size, chapterCount };
  },
  async syncRemote(updateUrl: string) {
    const cleanUrl = updateUrl.trim();
    if (!cleanUrl) return { storyCount: 0, chapterCount: 0, skipped: true, dataUpdated: false, appUpdate: null };
    const cacheBust = `${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const response = await fetch(cacheBust, { cache: 'no-store' });
    if (!response.ok) throw new Error(`GitHub update failed: ${response.status}`);
    const data = await response.json();
    const index = data as UpdateIndex;
    const appUpdate = appUpdateFromIndex(index);

    if (index.archiveUrl && index.dataVersion) {
      const currentMeta = readRemoteMeta();
      if (currentMeta.dataVersion === index.dataVersion) {
        return { storyCount: remoteStories().length, chapterCount: 0, skipped: true, dataUpdated: false, appUpdate };
      }
      const archiveUrl = absoluteUrl(index.archiveUrl, cleanUrl);
      const archiveResponse = await fetch(`${archiveUrl}${archiveUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
      if (!archiveResponse.ok) throw new Error(`Pack update failed: ${archiveResponse.status}`);
      const archive = await archiveResponse.arrayBuffer();
      if (index.sha256 && (await sha256Hex(archive)) !== index.sha256) throw new Error('Pack checksum mismatch');
      const stories = await storiesFromPack(archive);
      const result = writeRemoteStories(stories);
      writeRemoteMeta({ dataVersion: index.dataVersion, updatedAt: new Date().toISOString() });
      return { ...result, skipped: false, dataUpdated: true, appUpdate };
    }

    const stories = normalizeRemoteStories(data, cleanUrl);
    const result = writeRemoteStories(stories);
    return { ...result, skipped: false, dataUpdated: true, appUpdate };
  },
};
