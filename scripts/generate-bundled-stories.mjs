import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import matter from 'gray-matter';
import JSZip from 'jszip';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const storiesDir = path.join(root, 'stories');
const outDir = path.join(root, 'public', 'bundled-stories');
const updatesDir = path.join(root, 'public', 'updates');
const appVersionName = '1.13';
const appVersionCode = 14;
const releaseBaseUrl = `https://github.com/corexchange1/leaf-novel/releases/download/v${appVersionName}`;
const rawPublicBaseUrl = 'https://raw.githubusercontent.com/corexchange1/leaf-novel/master/public';
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);

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

function isImageEntry(entry) {
  return entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase());
}

function fileStem(filename) {
  return filename.replace(/\.[^.]+$/, '');
}

function chapterImageAssets(entries, chapterNumber) {
  const padded = String(chapterNumber).padStart(3, '0');
  const legacy = [];
  let cover = null;
  const numbered = [];

  for (const entry of entries) {
    if (!isImageEntry(entry)) continue;
    const stem = fileStem(entry.name).toLowerCase();
    if (stem === `${padded}-cover`) {
      cover = entry;
      continue;
    }
    const match = stem.match(new RegExp(`^${padded}-(\\d+)$`));
    if (match) {
      numbered.push({ entry, order: Number.parseInt(match[1], 10) });
      continue;
    }
    if (stem === padded || stem === String(chapterNumber)) {
      legacy.push({ entry, order: 1 });
    }
  }

  numbered.sort((a, b) => a.order - b.order);
  return { cover, numbered: numbered.length ? numbered : legacy };
}

function webpName(sourceName, suffix = '') {
  return `${fileStem(sourceName)}${suffix}.webp`;
}

async function writeCompressedImage(source, target, { max = 1600, quality = 82 } = {}) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await execFileAsync('magick', [source, '-auto-orient', '-resize', `${max}x${max}>`, '-quality', String(quality), target]);
  } catch {
    await fs.copyFile(source, target);
  }
}

async function writePublicImage({ source, publicTarget, max, quality }) {
  await writeCompressedImage(source, publicTarget, { max, quality });
  return publicTarget;
}

function publicUrlFor(storyId, relative) {
  return `/bundled-stories/${storyId}/${relative.replaceAll(path.sep, '/')}`;
}

function publicPathFromUrl(publicUrl) {
  if (!publicUrl || !publicUrl.startsWith('/bundled-stories/')) return '';
  return path.join(root, 'public', publicUrl.replace(/^\/+/, ''));
}

function inlineImagesFromContent(content) {
  const images = new Set();
  const patterns = [
    /!\[[^\]]*\]\(([^)]+)\)/g,
    /\{\{\s*image\s+[^}]*src\s*=\s*["']?([^"'\s}]+)["']?[^}]*\}\}/gi,
    /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const src = match[1]?.trim();
      if (!src || /^(https?:|data:|blob:|\/)/i.test(src) || src.includes('..')) continue;
      images.add(src.replace(/^\.?\//, ''));
    }
  }
  return Array.from(images);
}

function replaceAssetRefs(content, assets) {
  let next = content;
  for (const asset of assets) {
    next = next.split(asset.source).join(asset.publicUrl);
    next = next.split(`./${asset.source}`).join(asset.publicUrl);
  }
  return next;
}

async function prepareChapterImage(storyId, chaptersPath, storyOutDir, entry, { thumb = false } = {}) {
  const targetName = webpName(entry.name, thumb ? '-thumb' : '');
  const relative = path.join('chapters', targetName);
  const publicTarget = path.join(storyOutDir, relative);
  await writePublicImage({
    source: path.join(chaptersPath, entry.name),
    publicTarget,
    max: thumb ? 520 : 1600,
    quality: thumb ? 74 : 82,
  });
  return {
    source: entry.name,
    publicUrl: publicUrlFor(storyId, relative),
    file: `stories/${storyId}/${relative.replaceAll(path.sep, '/')}`,
  };
}

async function copyInlineImages(storyId, chapter, chaptersPath, storyOutDir) {
  chapter.inlineImageFiles = [];
  for (const relative of inlineImagesFromContent(chapter.content)) {
    const source = path.join(chaptersPath, relative);
    if (!(await exists(source))) continue;
    const targetRelative = path.join('chapters', relative.replace(/\.[^.]+$/, '.webp'));
    const publicTarget = path.join(storyOutDir, targetRelative);
    await writePublicImage({ source, publicTarget, max: 1600, quality: 82 });
    chapter.inlineImageFiles.push({
      source: relative,
      file: `stories/${storyId}/${targetRelative.replaceAll(path.sep, '/')}`,
      publicUrl: publicUrlFor(storyId, targetRelative),
    });
  }
}

function markdownImage(asset) {
  return `![${asset.alt}](${asset.publicUrl}){effect=none}`;
}

function htmlImage(asset) {
  return `<figure><img src="${asset.publicUrl}" alt="${asset.alt}" data-effect="none"></figure>`;
}

function contentHasAsset(content, asset) {
  return content.includes(asset.publicUrl) || content.includes(asset.source) || content.includes(`./${asset.source}`);
}

function insertAtRatios(count, total) {
  if (count <= 1) return [0.62];
  return Array.from({ length: count }, (_, index) => 0.48 + (0.32 * index) / Math.max(1, count - 1));
}

function injectNumberedImages(chapter, numberedAssets) {
  const assets = numberedAssets.filter((asset) => asset.order > 1 && !contentHasAsset(chapter.content, asset));
  if (!assets.length) return;

  if (chapter.contentFormat === 'html') {
    const matches = Array.from(chapter.content.matchAll(/<\/p>/gi));
    if (!matches.length) {
      chapter.content = `${chapter.content}\n${assets.map(htmlImage).join('\n')}`;
      return;
    }
    const ratios = insertAtRatios(assets.length, matches.length);
    let next = chapter.content;
    const inserts = assets
      .map((asset, index) => ({
        asset,
        at: matches[Math.min(matches.length - 1, Math.max(0, Math.round(matches.length * ratios[index]) - 1))].index + 4,
      }))
      .sort((a, b) => b.at - a.at);
    for (const item of inserts) {
      next = `${next.slice(0, item.at)}\n${htmlImage(item.asset)}${next.slice(item.at)}`;
    }
    chapter.content = next;
    return;
  }

  const blocks = chapter.content.split(/\n{2,}/);
  const ratios = insertAtRatios(assets.length, blocks.length);
  for (let index = assets.length - 1; index >= 0; index -= 1) {
    const position = Math.min(blocks.length, Math.max(1, Math.round(blocks.length * ratios[index])));
    blocks.splice(position, 0, markdownImage(assets[index]));
  }
  chapter.content = blocks.join('\n\n');
}

function rewritePublicInlineImages(content, chapter) {
  let next = content;
  for (const asset of chapter.inlineImageFiles || []) {
    next = next.split(asset.source).join(asset.publicUrl);
    next = next.split(`./${asset.source}`).join(asset.publicUrl);
  }
  return next;
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
      title: String(parsed.data.title || firstHeading || `Chuong ${String(number).padStart(3, '0')}`),
      filename: entry.name,
      contentFormat: isHtml ? 'html' : 'markdown',
      content: parsed.content.trim(),
    };

    const assets = chapterImageAssets(entries, number);
    const numberedAssets = [];
    for (const item of assets.numbered) {
      const asset = await prepareChapterImage(storyId, chaptersPath, storyOutDir, item.entry);
      numberedAssets.push({
        ...asset,
        order: item.order,
        alt: `Anh chuong ${String(number).padStart(3, '0')}-${String(item.order).padStart(2, '0')}`,
      });
    }
    chapter.numberedImageFiles = numberedAssets;

    if (numberedAssets[0]) {
      chapter.imageUrl = numberedAssets[0].publicUrl;
      chapter.imageFile = numberedAssets[0].file;
    }

    const thumbnailSource = assets.cover || assets.numbered[0]?.entry;
    if (thumbnailSource) {
      const thumbnail = await prepareChapterImage(storyId, chaptersPath, storyOutDir, thumbnailSource, { thumb: true });
      chapter.thumbnailUrl = thumbnail.publicUrl;
      chapter.thumbnailFile = thumbnail.file;
    }

    chapter.content = replaceAssetRefs(chapter.content, numberedAssets);
    await copyInlineImages(storyId, chapter, chaptersPath, storyOutDir);
    chapter.content = rewritePublicInlineImages(chapter.content, chapter);
    injectNumberedImages(chapter, numberedAssets);

    chapters.push(chapter);
  }

  chapters.sort((a, b) => a.number - b.number);

  const coverPath = path.join(storyPath, 'cover.png');
  let coverUrl = '';
  if (await exists(coverPath)) {
    await writePublicImage({ source: coverPath, publicTarget: path.join(storyOutDir, 'cover.webp'), max: 900, quality: 78 });
    coverUrl = `/bundled-stories/${storyId}/cover.webp`;
  }

  return {
    story: {
      ...meta,
      id: meta.id || storyId,
      totalChapters: Math.max(meta.totalChapters || 0, chapters.length),
      coverUrl,
      coverFile: coverUrl ? `stories/${storyId}/cover.webp` : undefined,
    },
    chapters,
  };
}

async function addPublicAsset(zip, archivePath, publicUrl) {
  const publicPath = publicPathFromUrl(publicUrl);
  if (archivePath && publicPath && (await exists(publicPath))) {
    zip.file(archivePath, await fs.readFile(publicPath));
  }
}

async function addPackAssets(zip, stories) {
  for (const item of stories) {
    await addPublicAsset(zip, item.story.coverFile, item.story.coverUrl);

    for (const chapter of item.chapters) {
      await addPublicAsset(zip, chapter.imageFile, chapter.imageUrl);
      await addPublicAsset(zip, chapter.thumbnailFile, chapter.thumbnailUrl);
      for (const asset of chapter.inlineImageFiles || []) {
        await addPublicAsset(zip, asset.file, asset.publicUrl);
      }
      for (const asset of chapter.numberedImageFiles || []) {
        await addPublicAsset(zip, asset.file, asset.publicUrl);
      }
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
        content: chapter.content.replaceAll(`/bundled-stories/${item.story.id}/chapters/`, ''),
        imageUrl: chapter.imageFile || chapter.imageUrl,
        thumbnailUrl: chapter.thumbnailFile || chapter.thumbnailUrl,
      })),
    })),
  };
}

function absolutePublicUrl(value) {
  if (!value || /^(https?:|data:|blob:)/i.test(value)) return value || '';
  return `${rawPublicBaseUrl}/${value.replace(/^\/+/, '')}`;
}

function indexManifest(stories) {
  return stories.map((item) => ({
    story: {
      ...item.story,
      coverUrl: absolutePublicUrl(item.story.coverUrl),
    },
    chapters: item.chapters.map((chapter) => ({
      ...chapter,
      content: chapter.content.replaceAll('/bundled-stories/', `${rawPublicBaseUrl}/bundled-stories/`),
      imageUrl: absolutePublicUrl(chapter.imageUrl),
      thumbnailUrl: absolutePublicUrl(chapter.thumbnailUrl),
    })),
  }));
}

async function writeUpdatePack(stories) {
  await fs.rm(updatesDir, { recursive: true, force: true });
  await fs.mkdir(updatesDir, { recursive: true });
  const dataVersion = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 12);
  const zip = new JSZip();
  await addPackAssets(zip, stories);
  zip.file('manifest.json', `${JSON.stringify(packManifest(stories), null, 2)}\n`);
  const archive = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await fs.writeFile(path.join(updatesDir, 'stories-pack.zip'), archive);
  await fs.writeFile(
    path.join(updatesDir, 'stories-index.json'),
    `${JSON.stringify(
      {
        dataVersion,
        stories: indexManifest(stories),
        packUrl: 'stories-pack.zip',
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
