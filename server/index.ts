import cors from 'cors';
import express from 'express';
import matter from 'gray-matter';
import fs from 'node:fs/promises';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT ?? 5174);
const storiesDir = path.resolve(process.env.STORIES_DIR ?? path.join(process.cwd(), 'stories'));

app.use(cors());

type StoryMeta = {
  id: string;
  title: string;
  status: string;
  totalChapters: number;
  genres: string[];
  summary: string;
  description: string;
  updatedAt: string;
  coverUrl: string;
};

type ChapterMeta = {
  storyId: string;
  number: number;
  title: string;
  filename: string;
  contentFormat: 'markdown' | 'html';
  imageUrl?: string;
};

function safeId(id: string) {
  return /^[a-zA-Z0-9-_]+$/.test(id);
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

async function listStoryIds() {
  try {
    const entries = await fs.readdir(storiesDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && safeId(entry.name)).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function getStory(id: string): Promise<StoryMeta | null> {
  if (!safeId(id)) return null;
  const storyPath = path.join(storiesDir, id);
  const meta = await readJson<Omit<StoryMeta, 'coverUrl'>>(path.join(storyPath, 'meta.json'));
  if (!meta) return null;
  const chapters = await listChapters(id);
  return {
    ...meta,
    id: meta.id || id,
    totalChapters: meta.totalChapters || chapters.length,
    coverUrl: `/api/stories/${id}/cover`,
  };
}

async function listChapters(storyId: string): Promise<ChapterMeta[]> {
  if (!safeId(storyId)) return [];
  const chaptersPath = path.join(storiesDir, storyId, 'chapters');
  try {
    const entries = await fs.readdir(chaptersPath, { withFileTypes: true });
    const chapters = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.html')))
        .map(async (entry) => {
          const number = Number.parseInt(entry.name, 10);
          const filename = entry.name;
          const raw = await fs.readFile(path.join(chaptersPath, filename), 'utf8');
          const isHtml = filename.endsWith('.html');
          const contentFormat: ChapterMeta['contentFormat'] = isHtml ? 'html' : 'markdown';
          const parsed = isHtml ? { data: {} as Record<string, unknown>, content: raw } : matter(raw);
          const firstHeading = isHtml ? htmlTitle(raw) : parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
          return {
            storyId,
            number: Number.isFinite(number) ? number : 0,
            title: String(parsed.data.title || firstHeading || `Chương ${String(number).padStart(3, '0')}`),
            filename,
            contentFormat,
            imageUrl: imageForChapter(entries, number) ? `/api/stories/${storyId}/chapters/${number}/image` : undefined,
          };
        }),
    );
    return chapters.filter((chapter) => chapter.number > 0).sort((a, b) => a.number - b.number);
  } catch {
    return [];
  }
}

function imageForChapter(entries: { isFile: () => boolean; name: string }[], chapterNumber: number) {
  const padded = String(chapterNumber).padStart(3, '0');
  return entries.find((entry) => {
    if (!entry.isFile()) return false;
    const lower = entry.name.toLowerCase();
    const stem = lower.replace(/\.[^.]+$/, '');
    return (
      (stem === String(chapterNumber) || stem === padded) &&
      (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp'))
    );
  });
}

function htmlTitle(raw: string) {
  return (
    raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  )
    ?.replace(/<[^>]+>/g, '')
    .trim();
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, storiesDir });
});

app.get('/api/stories', async (_request, response) => {
  const ids = await listStoryIds();
  const stories = (await Promise.all(ids.map(getStory))).filter(Boolean) as StoryMeta[];
  stories.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  response.json(stories);
});

app.get('/api/stories/:id', async (request, response) => {
  const story = await getStory(request.params.id);
  if (!story) {
    response.status(404).json({ error: 'Story not found' });
    return;
  }
  response.json(story);
});

app.get('/api/stories/:id/cover', async (request, response) => {
  if (!safeId(request.params.id)) {
    response.status(400).end();
    return;
  }
  const storyPath = path.join(storiesDir, request.params.id);
  const coverPath = path.join(storyPath, 'cover.png');
  if (!(await exists(coverPath))) {
    response.status(404).end();
    return;
  }
  response.sendFile(coverPath);
});

app.get('/api/stories/:id/chapters', async (request, response) => {
  const chapters = await listChapters(request.params.id);
  if (!chapters.length) {
    response.status(404).json({ error: 'No chapters found' });
    return;
  }
  response.json(chapters);
});

app.get('/api/stories/:id/chapters/:chapterNumber', async (request, response) => {
  if (!safeId(request.params.id)) {
    response.status(400).json({ error: 'Invalid story id' });
    return;
  }
  const chapterNumber = Number.parseInt(request.params.chapterNumber, 10);
  const chapter = (await listChapters(request.params.id)).find((item) => item.number === chapterNumber);
  if (!chapter) {
    response.status(404).json({ error: 'Chapter not found' });
    return;
  }
  const filename = chapter.filename;
  const chapterPath = path.join(storiesDir, request.params.id, 'chapters', filename);
  try {
    const raw = await fs.readFile(chapterPath, 'utf8');
    const isHtml = chapter.contentFormat === 'html';
    const parsed = isHtml ? { data: {} as Record<string, unknown>, content: raw } : matter(raw);
    const firstHeading = isHtml ? htmlTitle(raw) : parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
    response.json({
      storyId: request.params.id,
      number: chapterNumber,
      title: String(parsed.data.title || firstHeading || `Chương ${String(chapterNumber).padStart(3, '0')}`),
      filename,
      content: parsed.content.trim(),
      contentFormat: chapter.contentFormat,
      imageUrl: chapter.imageUrl,
    });
  } catch {
    response.status(404).json({ error: 'Chapter not found' });
  }
});

app.get('/api/stories/:id/chapters/:chapterNumber/image', async (request, response) => {
  if (!safeId(request.params.id)) {
    response.status(400).end();
    return;
  }
  const chapterNumber = Number.parseInt(request.params.chapterNumber, 10);
  const chaptersPath = path.join(storiesDir, request.params.id, 'chapters');
  try {
    const entries = await fs.readdir(chaptersPath, { withFileTypes: true });
    const image = imageForChapter(entries, chapterNumber);
    if (!image) {
      response.status(404).end();
      return;
    }
    response.sendFile(path.join(chaptersPath, image.name));
  } catch {
    response.status(404).end();
  }
});

app.listen(port, () => {
  console.log(`LeafNovel API listening at http://localhost:${port}`);
  console.log(`Reading stories from ${storiesDir}`);
});
