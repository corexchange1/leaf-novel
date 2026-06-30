export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Vừa xong';
  return `${date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} • ${date.toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
  })}`;
}

export function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours <= 0) return `${mins} phút`;
  if (mins === 0) return `${hours} giờ`;
  return `${hours} giờ ${mins} phút`;
}

export function chapterLabel(chapterNumber: number, total?: number) {
  return `Chương ${chapterNumber}${total ? `/${total}` : ''}`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
