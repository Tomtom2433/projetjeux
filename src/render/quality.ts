// Quality tiers: the same scene scaled for phones, tablets and desktops.
export type Tier = 'low' | 'medium' | 'high';

export interface Quality {
  tier: Tier;
  pixelRatio: number;
  antialias: boolean;
  shadows: boolean;
  shadowMap: number;
  groundTex: number;
  grass: number;
  bushes: number;
  pointLights: number;
  litScale: number;
}

const TIERS: Record<Tier, Omit<Quality, 'tier'>> = {
  low: { pixelRatio: 1, antialias: false, shadows: false, shadowMap: 0, groundTex: 1024, grass: 350, bushes: 110, pointLights: 0, litScale: 1 },
  medium: { pixelRatio: 1.5, antialias: false, shadows: true, shadowMap: 1024, groundTex: 2048, grass: 1100, bushes: 220, pointLights: 0, litScale: 1 },
  high: { pixelRatio: 2, antialias: true, shadows: true, shadowMap: 2048, groundTex: 4096, grass: 2400, bushes: 320, pointLights: 3, litScale: 2 },
};

const KEY = 'last-signal.quality';

export function storedTier(): Tier | 'auto' {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'low' || v === 'medium' || v === 'high') return v;
  } catch {
    /* ignore */
  }
  return 'auto';
}

export function storeTier(t: Tier | 'auto') {
  try {
    if (t === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    /* ignore */
  }
}

export function detectTier(): Tier {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (coarse) return mem <= 3 || cores <= 4 ? 'low' : 'medium';
  return cores >= 8 ? 'high' : 'medium';
}

export function getQuality(): Quality {
  const s = storedTier();
  const tier = s === 'auto' ? detectTier() : s;
  const q = { tier, ...TIERS[tier] };
  q.pixelRatio = Math.min(q.pixelRatio, window.devicePixelRatio || 1);
  return q;
}
