import { createStore, get, set, del, entries } from 'idb-keyval';
import { defaultPreferences, type Book, type Position, type Preferences } from '../shared/types';
const store = createStore('livronovel-temporary', 'readings');
export type Reading = {
  book: Book;
  position: Position | null;
  saved: boolean;
  owner: string | null;
  version: number;
  updatedAt: number;
};
function tabKey() {
  let key = sessionStorage.getItem('ln-tab');
  if (!key) {
    key = crypto.randomUUID();
    sessionStorage.setItem('ln-tab', key);
  }
  return key;
}
export async function loadReading(): Promise<Reading | undefined> {
  const key = tabKey();
  const records = await entries<string, Reading>(store);
  await Promise.all(
    records
      .filter(([, value]) => Date.now() - value.updatedAt > 86_400_000)
      .map(([id]) => del(id, store)),
  );
  const reading = await get<Reading>(key, store);
  const staged = JSON.parse(sessionStorage.getItem('ln-position') || 'null');
  if (reading && staged?.bookId === reading.book.id) reading.position = staged.position;
  return reading;
}
export async function storeReading(reading: Reading) {
  await set(tabKey(), { ...reading, updatedAt: Date.now() }, store);
}
export function stagePosition(bookId: string, position: Position) {
  sessionStorage.setItem('ln-position', JSON.stringify({ bookId, position }));
}
export async function clearReading() {
  await del(tabKey(), store);
  sessionStorage.removeItem('ln-tab');
  sessionStorage.removeItem('ln-position');
}
export function readPreferences(): Preferences {
  try {
    const p = JSON.parse(localStorage.getItem('ln-preferences') || '{}');
    return {
      theme: ['light', 'dark', 'sepia'].includes(p.theme) ? p.theme : defaultPreferences.theme,
      font: p.font === 'sans' ? 'sans' : 'serif',
      fontSize: Number.isFinite(p.fontSize) ? Math.min(32, Math.max(16, p.fontSize)) : 20,
      lineHeight: Number.isFinite(p.lineHeight) ? Math.min(2.4, Math.max(1.4, p.lineHeight)) : 1.9,
    };
  } catch {
    return { ...defaultPreferences };
  }
}
export function writePreferences(preferences: Preferences) {
  localStorage.setItem('ln-preferences', JSON.stringify(preferences));
}
