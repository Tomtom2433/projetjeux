// Local save/load. The whole simulation state is plain JSON.
import type { GameState } from './types';
import { SAVE_VERSION } from './state';

const KEY = 'last-signal.save';

export interface KeyValueStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const serialize = (s: GameState): string => JSON.stringify(s);

export function deserialize(raw: string): GameState | null {
  try {
    const s = JSON.parse(raw) as GameState;
    if (!s || s.version !== SAVE_VERSION || !Array.isArray(s.survivors)) return null;
    return s;
  } catch {
    return null;
  }
}

function store(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveGame(s: GameState, st: KeyValueStore | null = store()): boolean {
  try {
    st?.setItem(KEY, serialize(s));
    return !!st;
  } catch {
    return false;
  }
}

export function loadGame(st: KeyValueStore | null = store()): GameState | null {
  try {
    const raw = st?.getItem(KEY);
    return raw ? deserialize(raw) : null;
  } catch {
    return null;
  }
}

export function clearSave(st: KeyValueStore | null = store()) {
  try {
    st?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
