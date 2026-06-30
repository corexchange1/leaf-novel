type TextBlock = {
  type: 'paragraph' | 'dialogue';
  text: string;
  speaker?: string;
  color?: string;
};

type ImageBlock = {
  type: 'image';
  src: string;
  alt: string;
  effect?: 'shake' | 'flash' | 'blur' | 'pulse' | 'none' | string;
};

export type ChapterTextBlock = TextBlock | ImageBlock;

const speakerColors: Record<string, string> = {
  'Như': '#B8860B',
  'Lâm': '#5FAE5F',
  'Hồng': '#D94B8A',
  'Vy': '#008C8C',
  'Minh': '#777777',
  'Thanh': '#1F6B3A',
};

export function chapterToBlocks(content: string, format: 'markdown' | 'html' = 'markdown'): ChapterTextBlock[] {
  return format === 'html' ? htmlToBlocks(content) : markdownToBlocks(content);
}

function markdownToBlocks(markdown: string): ChapterTextBlock[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s+.*$/gm, '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(parseMarkdownBlock);
}

function parseMarkdownBlock(block: string): ChapterTextBlock {
  const image = parseMarkdownImage(block) || parseImageTag(block);
  if (image) return image;

  const colored = block.match(/^<span\s+style="([^"]+)"[^>]*>([\s\S]*)<\/span>$/i);
  if (colored) {
    const color = colored[1].match(/color\s*:\s*(#[0-9a-f]{3,8}|[a-z]+)/i)?.[1];
    return parseSpeakerBlock(stripInlineMarkup(colored[2]), color);
  }

  return parseSpeakerBlock(stripInlineMarkup(block));
}

function htmlToBlocks(html: string): ChapterTextBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.querySelector('main') || doc.body;
  const nodes = Array.from(root.querySelectorAll('p, img, figure'));
  return nodes
    .map((node) => {
      const element = node as HTMLElement;
      if (element.tagName.toLowerCase() === 'img') {
        return {
          type: 'image' as const,
          src: (element as HTMLImageElement).getAttribute('src') || '',
          alt: (element as HTMLImageElement).getAttribute('alt') || '',
          effect: element.dataset.effect || element.dataset.fx || element.getAttribute('effect') || undefined,
        };
      }
      if (element.tagName.toLowerCase() === 'figure') {
        const image = element.querySelector('img');
        if (image) {
          return {
            type: 'image' as const,
            src: image.getAttribute('src') || '',
            alt: image.getAttribute('alt') || element.querySelector('figcaption')?.textContent?.trim() || '',
            effect: image.dataset.effect || image.dataset.fx || element.dataset.effect || element.dataset.fx || undefined,
          };
        }
      }
      const speaker =
        element.dataset.speaker ||
        element.querySelector('.speaker')?.textContent?.replace(/:$/, '').trim() ||
        undefined;
      const color = element.style.getPropertyValue('--fg') || undefined;
      const speech = element.querySelector('.speech')?.textContent?.trim();
      const text = speech || element.textContent?.trim() || '';

      if (speaker) return parseSpeakerBlock(`${speaker}: ${text}`, color);
      return { type: 'paragraph' as const, text };
    })
    .filter((block) => (block.type === 'image' ? block.src : block.text));
}

function parseSpeakerBlock(block: string, explicitColor?: string): ChapterTextBlock {
  const match = block.match(/^([^:\n]{1,32}):\s*([\s\S]+)/);
  const speaker = match?.[1]?.trim();
  if (!match || !speaker) return { type: 'paragraph', text: block };

  return {
    type: 'dialogue',
    speaker,
    text: match[2].trim(),
    color: explicitColor || speakerColors[speaker],
  };
}

function stripInlineMarkup(value: string) {
  return decodeHtml(value)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function decodeHtml(value: string) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function parseMarkdownImage(block: string): ChapterTextBlock | null {
  const match = block.match(/^!\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]+)\})?$/);
  if (!match) return null;
  return {
    type: 'image',
    alt: decodeHtml(match[1].trim()),
    src: match[2].trim(),
    effect: parseEffect(match[3]),
  };
}

function parseImageTag(block: string): ChapterTextBlock | null {
  const match = block.match(/^\{\{\s*image\s+([\s\S]+?)\s*\}\}$/i);
  if (!match) return null;
  const attrs = parseAttributes(match[1]);
  if (!attrs.src) return null;
  return {
    type: 'image',
    src: attrs.src,
    alt: attrs.alt || '',
    effect: attrs.effect || attrs.fx,
  };
}

function parseEffect(value?: string) {
  if (!value) return undefined;
  const explicit = value.match(/(?:effect|fx)\s*=\s*["']?([a-z-]+)["']?/i)?.[1];
  return explicit || value.trim();
}

function parseAttributes(value: string) {
  const attrs: Record<string, string> = {};
  value.replace(/([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s]+))/g, (_, key, _raw, doubleQuoted, singleQuoted, bare) => {
    attrs[key.toLowerCase()] = doubleQuoted || singleQuoted || bare || '';
    return '';
  });
  return attrs;
}
