import { create } from 'zustand';
import type { AudioChapter, AudioVariant, Story } from '../types';
import { clamp } from '../utils/format';

const audioStateKey = 'leafnovel:audio-player-state';
const progressWriteMs = 2500;
const speedSteps = [0.75, 1, 1.25, 1.5, 1.75, 2];

export type AudioTrack = {
  story: Pick<Story, 'id' | 'title' | 'coverUrl' | 'totalChapters'>;
  chapter: AudioChapter;
  variant: AudioVariant;
  index: number;
  title: string;
  subtitle: string;
  coverUrl: string;
};

type PersistedAudioState = {
  track?: {
    story: AudioTrack['story'];
    chapter: AudioChapter;
    variant: AudioVariant;
    index: number;
  };
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  queue: AudioTrack[];
  updatedAt: string;
};

type LoadQueueInput = {
  story: AudioTrack['story'];
  chapters: AudioChapter[];
  chapterNumber: number;
  variantId?: string;
  autoplay?: boolean;
};

type AudioPlayerStore = {
  queue: AudioTrack[];
  currentIndex: number;
  currentTrack: AudioTrack | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackSpeed: number;
  isReady: boolean;
  loadQueue: (input: LoadQueueInput) => void;
  playTrackAt: (index: number, autoplay?: boolean) => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  seek: (time: number) => void;
  setSpeed: (speed: number) => void;
  cycleSpeed: () => void;
};

let audio: HTMLAudioElement | null = null;
let lastProgressWrite = 0;

function accountId() {
  try {
    return JSON.parse(localStorage.getItem('leafnovel:session') || '""') || 'guest';
  } catch {
    return 'guest';
  }
}

function audioProgressKey(storyId: string) {
  return `leafnovel:audio-progress:${accountId()}:${storyId}`;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private WebViews; playback should continue.
  }
}

function now() {
  return new Date().toISOString();
}

function variantLabel(variant?: Pick<AudioVariant, 'id' | 'label'> | null) {
  if (!variant) return 'Audio';
  if (variant.id === 'long' || /lồng/i.test(variant.label)) return 'Lồng tiếng';
  if (variant.id === 'tell' || /kể|audio/i.test(variant.label)) return 'Audio';
  return variant.label;
}

function chapterVariants(chapter: AudioChapter): AudioVariant[] {
  return chapter.variants?.length
    ? chapter.variants
    : [{ id: 'main', label: 'Audio', filename: chapter.filename, audioUrl: chapter.audioUrl, durationSeconds: chapter.durationSeconds }];
}

function buildQueue(story: LoadQueueInput['story'], chapters: AudioChapter[], variantId?: string) {
  return chapters.map((chapter, index) => {
    const variants = chapterVariants(chapter);
    const variant = variants.find((item) => item.id === variantId) || variants[0];
    return {
      story,
      chapter,
      variant,
      index,
      title: chapter.title,
      subtitle: `${story.title} - ${variantLabel(variant)}`,
      coverUrl: story.coverUrl,
    };
  });
}

function trackKey(track: AudioTrack | null) {
  return track ? `${track.story.id}:${track.chapter.chapterNumber}:${track.variant.id}` : '';
}

function persistState() {
  const state = useAudioPlayerStore.getState();
  if (!state.currentTrack) return;
  writeJson(audioStateKey, {
    track: {
      story: state.currentTrack.story,
      chapter: state.currentTrack.chapter,
      variant: state.currentTrack.variant,
      index: state.currentTrack.index,
    },
    currentTime: state.currentTime,
    duration: state.duration,
    playbackSpeed: state.playbackSpeed,
    queue: state.queue,
    updatedAt: now(),
  } satisfies PersistedAudioState);
}

function writeProgress() {
  const state = useAudioPlayerStore.getState();
  const track = state.currentTrack;
  if (!track || state.currentTime < 2) return;
  writeJson(audioProgressKey(track.story.id), {
    storyId: track.story.id,
    chapterNumber: track.chapter.chapterNumber,
    variantId: track.variant.id,
    currentTime: state.currentTime,
    duration: state.duration || track.variant.durationSeconds || 0,
    updatedAt: now(),
  });
}

function setMediaPosition() {
  if (!('mediaSession' in navigator)) return;
  const state = useAudioPlayerStore.getState();
  try {
    navigator.mediaSession.setPositionState?.({
      duration: Math.max(state.duration || 0, 0),
      playbackRate: state.playbackSpeed,
      position: clamp(state.currentTime, 0, state.duration || state.currentTime || 0),
    });
  } catch {
    // Older Android WebView builds can expose MediaSession without position state.
  }
}

function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const state = useAudioPlayerStore.getState();
  const track = state.currentTrack;
  if (!track) return;

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.subtitle,
    album: 'Leaf Novel',
    artwork: track.coverUrl ? [{ src: track.coverUrl, sizes: '512x512', type: 'image/png' }] : undefined,
  });
  navigator.mediaSession.playbackState = state.isPlaying ? 'playing' : 'paused';

  const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Some Android WebView versions do not support every action.
    }
  };

  setHandler('play', () => void useAudioPlayerStore.getState().play());
  setHandler('pause', () => useAudioPlayerStore.getState().pause());
  setHandler('seekto', (details) => {
    if (typeof details.seekTime === 'number') useAudioPlayerStore.getState().seek(details.seekTime);
  });
  setHandler('previoustrack', state.currentIndex > 0 ? () => useAudioPlayerStore.getState().playTrackAt(state.currentIndex - 1, true) : null);
  setHandler(
    'nexttrack',
    state.currentIndex < state.queue.length - 1 ? () => useAudioPlayerStore.getState().playTrackAt(state.currentIndex + 1, true) : null,
  );
  setMediaPosition();
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'metadata';

  audio.addEventListener('loadedmetadata', () => {
    const nextDuration = Number.isFinite(audio?.duration) ? audio?.duration || 0 : 0;
    useAudioPlayerStore.setState({ duration: nextDuration, isReady: true });
    persistState();
    updateMediaSession();
  });

  audio.addEventListener('durationchange', () => {
    const nextDuration = Number.isFinite(audio?.duration) ? audio?.duration || 0 : 0;
    useAudioPlayerStore.setState({ duration: nextDuration });
    updateMediaSession();
  });

  audio.addEventListener('timeupdate', () => {
    const currentTime = audio?.currentTime || 0;
    useAudioPlayerStore.setState({ currentTime });
    setMediaPosition();
    const timestamp = Date.now();
    if (timestamp - lastProgressWrite > progressWriteMs) {
      lastProgressWrite = timestamp;
      writeProgress();
      persistState();
    }
  });

  audio.addEventListener('play', () => {
    useAudioPlayerStore.setState({ isPlaying: true });
    updateMediaSession();
    persistState();
  });

  audio.addEventListener('pause', () => {
    useAudioPlayerStore.setState({ isPlaying: false });
    updateMediaSession();
    writeProgress();
    persistState();
  });

  audio.addEventListener('ended', () => {
    const state = useAudioPlayerStore.getState();
    if (state.currentIndex < state.queue.length - 1) {
      state.playTrackAt(state.currentIndex + 1, true);
      return;
    }
    useAudioPlayerStore.setState({ isPlaying: false });
    updateMediaSession();
    persistState();
  });

  return audio;
}

function setTrack(track: AudioTrack, queue: AudioTrack[], index: number, autoplay = false) {
  const player = ensureAudio();
  const previousKey = trackKey(useAudioPlayerStore.getState().currentTrack);
  const nextKey = trackKey(track);
  const persisted = readJson<PersistedAudioState | null>(audioStateKey, null);
  const shouldKeepTime = previousKey === nextKey && Boolean(player.src);
  const restoreTime = persisted?.track && `${persisted.track.story.id}:${persisted.track.chapter.chapterNumber}:${persisted.track.variant.id}` === nextKey
    ? persisted.currentTime
    : 0;

  useAudioPlayerStore.setState({
    queue,
    currentIndex: index,
    currentTrack: track,
    duration: track.variant.durationSeconds || 0,
    currentTime: shouldKeepTime ? player.currentTime || 0 : restoreTime,
    isReady: false,
  });

  if (!shouldKeepTime) {
    player.src = track.variant.audioUrl;
    player.load();
    if (restoreTime > 2) player.currentTime = restoreTime;
  }
  player.playbackRate = useAudioPlayerStore.getState().playbackSpeed;
  updateMediaSession();
  persistState();
  if (autoplay) void useAudioPlayerStore.getState().play();
}

const persisted = readJson<PersistedAudioState | null>(audioStateKey, null);

export const useAudioPlayerStore = create<AudioPlayerStore>((set, get) => ({
  queue: persisted?.queue || [],
  currentIndex: persisted?.track?.index ?? -1,
  currentTrack: persisted?.track
    ? {
        story: persisted.track.story,
        chapter: persisted.track.chapter,
        variant: persisted.track.variant,
        index: persisted.track.index,
        title: persisted.track.chapter.title,
        subtitle: `${persisted.track.story.title} - ${variantLabel(persisted.track.variant)}`,
        coverUrl: persisted.track.story.coverUrl,
      }
    : null,
  isPlaying: false,
  currentTime: persisted?.currentTime || 0,
  duration: persisted?.duration || persisted?.track?.variant.durationSeconds || 0,
  playbackSpeed: persisted?.playbackSpeed || 1,
  isReady: Boolean(persisted?.track),
  loadQueue: ({ story, chapters, chapterNumber, variantId, autoplay = false }) => {
    const queue = buildQueue(story, chapters, variantId);
    const index = Math.max(0, queue.findIndex((track) => track.chapter.chapterNumber === chapterNumber));
    const track = queue[index];
    if (!track) return;
    setTrack(track, queue, index, autoplay);
  },
  playTrackAt: (index, autoplay = true) => {
    const state = get();
    const track = state.queue[index];
    if (!track) return;
    setTrack(track, state.queue, index, autoplay);
  },
  play: async () => {
    const player = ensureAudio();
    const track = get().currentTrack;
    if (!track) return;
    if (!player.src) {
      player.src = track.variant.audioUrl;
      player.load();
      if (get().currentTime > 2) player.currentTime = get().currentTime;
    }
    player.playbackRate = get().playbackSpeed;
    try {
      await player.play();
    } catch {
      useAudioPlayerStore.setState({ isPlaying: false });
      updateMediaSession();
    }
  },
  pause: () => {
    ensureAudio().pause();
  },
  toggle: async () => {
    const player = ensureAudio();
    if (player.paused) await get().play();
    else get().pause();
  },
  seek: (time) => {
    const player = ensureAudio();
    const duration = get().duration || player.duration || 0;
    const nextTime = clamp(time, 0, duration || time);
    player.currentTime = nextTime;
    set({ currentTime: nextTime });
    setMediaPosition();
    persistState();
  },
  setSpeed: (speed) => {
    const normalized = speedSteps.includes(speed) ? speed : 1;
    ensureAudio().playbackRate = normalized;
    set({ playbackSpeed: normalized });
    updateMediaSession();
    persistState();
  },
  cycleSpeed: () => {
    const current = get().playbackSpeed;
    const index = speedSteps.indexOf(current);
    get().setSpeed(speedSteps[(index + 1) % speedSteps.length]);
  },
}));
