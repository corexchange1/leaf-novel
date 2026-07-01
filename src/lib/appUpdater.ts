import { Capacitor, registerPlugin } from '@capacitor/core';

type AppUpdaterPlugin = {
  info: () => Promise<{
    deviceFlavor?: 'phone' | 'tablet' | string;
    physicalDevice?: 'phone' | 'tablet' | string;
    packageName?: string;
    versionName?: string;
  }>;
  download: (options: { url: string; filename: string }) => Promise<{ downloadId: number; filename: string }>;
};

const AppUpdater = registerPlugin<AppUpdaterPlugin>('AppUpdater');

type DeviceFlavor = 'phone' | 'tablet';

export async function getDeviceFlavor() {
  const profile = await getDeviceProfile();
  return profile.physicalDevice === 'tablet' ? 'tablet' : 'phone';
}

export async function getDeviceProfile(): Promise<{
  installedFlavor: DeviceFlavor;
  physicalDevice: DeviceFlavor;
  packageName: string;
  versionName: string;
}> {
  try {
    const result = await AppUpdater.info();
    const installedFlavor = result.deviceFlavor === 'tablet' ? 'tablet' : 'phone';
    const physicalDevice = result.physicalDevice === 'tablet' ? 'tablet' : 'phone';
    return {
      installedFlavor,
      physicalDevice,
      packageName: result.packageName || '',
      versionName: result.versionName || '',
    };
  } catch {
    return {
      installedFlavor: 'phone' as const,
      physicalDevice: window.matchMedia?.('(min-width: 700px)').matches ? ('tablet' as const) : ('phone' as const),
      packageName: '',
      versionName: '',
    };
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
