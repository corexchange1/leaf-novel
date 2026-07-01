import { Capacitor, registerPlugin } from '@capacitor/core';

type AppUpdaterPlugin = {
  info: () => Promise<{ deviceFlavor?: 'phone' | 'tablet' | string }>;
  download: (options: { url: string; filename: string }) => Promise<{ downloadId: number; filename: string }>;
};

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

export async function getDeviceFlavor() {
  try {
    const result = await AppUpdater.info();
    return result.deviceFlavor === 'tablet' ? 'tablet' : 'phone';
  } catch {
    return 'phone';
  }
}

export async function downloadApk(url: string) {
  const filename = url.split('/').pop()?.split('?')[0] || 'leaf-novel-update.apk';
  if (Capacitor.isNativePlatform()) {
    return AppUpdater.download({ url, filename });
  }

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();
  return { downloadId: 0, filename };
}
