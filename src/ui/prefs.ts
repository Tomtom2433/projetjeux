// Player preferences kept outside the save: they belong to the device, not to a run.
import { ORDER_COLOR } from '../sim/text';

const get = (k: string) => {
  try {
    return localStorage.getItem('last-signal.' + k);
  } catch {
    return null;
  }
};
const set = (k: string, v: string) => {
  try {
    localStorage.setItem('last-signal.' + k, v);
  } catch {
    /* ignore */
  }
};

export const storedDifficulty = () => Math.min(2, Math.max(0, Number(get('difficulty') ?? 1)));
export const storeDifficulty = (d: number) => set('difficulty', String(d));

export const TEXT_SIZES = [1, 1.15, 1.3];
export const storedText = () => Math.min(2, Math.max(0, Number(get('text') ?? 0)));
export const storedSafe = () => get('safe') === '1';

const BASE = { ...ORDER_COLOR };
/** Order colours that stay apart for the common forms of colour blindness (Okabe-Ito). */
const SAFE: typeof BASE = { scout: '#56b4e9', retrieve: '#e69f00', hold: '#f0e442', retreat: '#cc79a7', rescue: '#d55e00' };

/** Apply text size and palette to the page. */
export function applyPrefs() {
  document.documentElement.style.setProperty('--txt', String(TEXT_SIZES[storedText()]));
  Object.assign(ORDER_COLOR, storedSafe() ? SAFE : BASE);
  document.body.classList.toggle('safe', storedSafe());
}
export function storeText(i: number) {
  set('text', String(i));
  applyPrefs();
}
export function storeSafe(on: boolean) {
  set('safe', on ? '1' : '0');
  applyPrefs();
}
