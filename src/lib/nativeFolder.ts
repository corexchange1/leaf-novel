import { Capacitor, registerPlugin } from '@capacitor/core';

export type NativeFolderFile = {
  name: string;
  path: string;
  content?: string;
  dataUrl?: string;
  mimeType?: string;
};

type PickFolderResult = {
  path: string;
  files: NativeFolderFile[];
};

type LocalFolderPlugin = {
  pick: () => Promise<PickFolderResult>;
};

const LocalFolder = registerPlugin<LocalFolderPlugin>('LocalFolder');

export async function pickNativeFolder() {
  if (!Capacitor.isNativePlatform()) return null;
  return LocalFolder.pick();
}
