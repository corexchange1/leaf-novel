export type ChapterTextBlock = {
  type: 'paragraph' | 'dialogue';
  text: string;
  speaker?: string;
  color?: string;
};

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
  const colored = block.match(/^<span\s+style="([^"]+)"[^>]*>([\s\S]*)<\/span>$/i);
  if (colored) {
    const color = colored[1].match(/color\s*:\s*(#[0-9a-f]{3,8}|[a-z]+)/i)?.[1];
    return parseSpeakerBlock(stripInlineMarkup(colored[2]), color);
  }

  return parseSpeakerBlock(stripInlineMarkup(block));
}

function htmlToBlocks(html: string): ChapterTextBlock[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const nodes = Array.from(doc.querySelectorAll('main p, body p'));
  return nodes
    .map((node) => {
      const element = node as HTMLElement;
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
    .filter((block) => block.text);
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
