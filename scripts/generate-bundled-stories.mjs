import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import JSZip from 'jszip';
import crypto from 'node:crypto';

const root = process.cwd();
const storiesDir = path.join(root, 'stories');
const outDir = path.join(root, 'public', 'bundled-stories');
const updatesDir = path.join(root, 'public', 'updates');
const appVersionName = '1.7';
const appVersionCode = 8;
const releaseBaseUrl = `https://github.com/corexchange1/leaf-novel/releases/download/v${appVersionName}`;

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeId(id) {
  return /^[a-zA-Z0-9-_]+$/.test(id);
}

function htmlTitle(raw) {
  return (
    raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
    raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  )
    ?.replace(/<[^>]+>/g, '')
    .trim();
}

function imageForChapter(entries, chapterNumber) {
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

async function readStory(storyId) {
  const storyPath = path.join(storiesDir, storyId);
  const meta = JSON.parse(await fs.readFile(path.join(storyPath, 'meta.json'), 'utf8'));
  const chaptersPath = path.join(storyPath, 'chapters');
  const entries = await fs.readdir(chaptersPath, { withFileTypes: true });
  const chapters = [];

  const storyOutDir = path.join(outDir, storyId);
  await fs.mkdir(storyOutDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.isFile() || (!entry.name.endsWith('.md') && !entry.name.endsWith('.html'))) continue;
    const number = Number.parseInt(entry.name, 10);
    if (!Number.isFinite(number) || number <= 0) continue;

    const raw = await fs.readFile(path.join(chaptersPath, entry.name), 'utf8');
    const isHtml = entry.name.endsWith('.html');
    const parsed = isHtml ? { data: {}, content: raw } : matter(raw);
    const firstHeading = isHtml ? htmlTitle(raw) : parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim();

    const chapter = {
      storyId,
      number,
      title: String(parsed.data.title || firstHeading || `Chương ${String(number).padStart(3, '0')}`),
      filename: entry.name,
      contentFormat: isHtml ? 'html' : 'markdown',
      content: parsed.content.trim(),
    };

    const image = imageForChapter(entries, number);
    if (image) {
      await fs.copyFile(path.join(chaptersPath, image.name), path.join(storyOutDir, image.name));
      chapter.imageUrl = `/bundled-stories/${storyId}/${image.name}`;
      chapter.imageFile = `stories/${storyId}/${image.name}`;
    }

    chapters.push(chapter);
  }

  chapters.sort((a, b) => a.number - b.number);

  const coverPath = path.join(storyPath, 'cover.png');
  let coverUrl = '';
  if (await exists(coverPath)) {
    await fs.copyFile(coverPath, path.join(storyOutDir, 'cover.png'));
    coverUrl = `/bundled-stories/${storyId}/cover.png`;
  }

  return {
    story: {
      ...meta,
      id: meta.id || storyId,
      totalChapters: Math.max(meta.totalChapters || 0, chapters.length),
      coverUrl,
    },
    chapters,
  };
}

async function addPackAssets(zip, stories) {
  for (const item of stories) {
    const storyId = item.story.id;
    const storyPath = path.join(storiesDir, storyId);
    const coverPath = path.join(storyPath, 'cover.png');
    if (await exists(coverPath)) {
      zip.file(`stories/${storyId}/cover.png`, await fs.readFile(coverPath));
      item.story.coverFile = `stories/${storyId}/cover.png`;
    }

    for (const chapter of item.chapters) {
      if (!chapter.imageFile) continue;
      const imagePath = path.join(storiesDir, storyId, 'chapters', path.basename(chapter.imageFile));
      if (await exists(imagePath)) zip.file(chapter.imageFile, await fs.readFile(imagePath));
    }
  }
}

function packManifest(stories) {
  return {
    generatedAt: new Date().toISOString(),
    stories: stories.map((item) => ({
      story: {
        ...item.story,
        coverUrl: item.story.coverFile || item.story.coverUrl,
      },
      chapters: item.chapters.map((chapter) => ({
        ...chapter,
        imageUrl: chapter.imageFile || chapter.imageUrl,
      })),
    })),
  };
}

async function writeUpdatePack(stories) {
  await fs.rm(updatesDir, { recursive: true, force: true });
  await fs.mkdir(updatesDir, { recursive: true });
  const dataVersion = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
  const zip = new JSZip();
  await addPackAssets(zip, stories);
  zip.file('manifest.json', `${JSON.stringify(packManifest(stories), null, 2)}\n`);
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex');
  await fs.writeFile(path.join(updatesDir, 'stories-pack.zip'), archive);
  await fs.writeFile(
    path.join(updatesDir, 'stories-index.json'),
    `${JSON.stringify(
      {
        dataVersion,
        archiveUrl: '/updates/stories-pack.zip',
        sha256,
        latestApp: {
          versionName: appVersionName,
          versionCode: appVersionCode,
          phoneApkUrl: `${releaseBaseUrl}/leaf-novel-v${appVersionName}-phone-debug.apk`,
          tabletApkUrl: `${releaseBaseUrl}/leaf-novel-v${appVersionName}-tablet-debug.apk`,
        },
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  const entries = await fs.readdir(storiesDir, { withFileTypes: true });
  const stories = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !safeId(entry.name)) continue;
    if (!(await exists(path.join(storiesDir, entry.name, 'meta.json')))) continue;
    stories.push(await readStory(entry.name));
  }

  stories.sort((a, b) => new Date(b.story.updatedAt).getTime() - new Date(a.story.updatedAt).getTime());
  await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify({ stories }, null, 2)}\n`);
  await writeUpdatePack(stories);
  console.log(`Bundled ${stories.length} stories into ${path.relative(root, outDir)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
