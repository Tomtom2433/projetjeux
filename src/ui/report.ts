// Problems are kept on the device: nothing is sent anywhere. The player can copy a report and pass it on.
const KEY = 'last-signal.errors';
export const VERSION = '0.9.0';

function push(text: string) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
    list.push(`${new Date().toISOString()} ${text}`.slice(0, 400));
    localStorage.setItem(KEY, JSON.stringify(list.slice(-15)));
  } catch {
    /* ignore */
  }
}

export function watchErrors() {
  window.addEventListener('error', (e) => push(`${e.message} @ ${(e.filename ?? '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => push(`promise: ${String((e.reason as Error)?.message ?? e.reason)}`));
}

/** A plain-text diagnostic the player can paste into a message. No personal data. */
export function buildReport(extra: Record<string, string | number>): string {
  let errors: string[] = [];
  try {
    errors = JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
  } catch {
    /* ignore */
  }
  return [
    `LAST SIGNAL ${VERSION}`,
    `Écran : ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}`,
    `Navigateur : ${navigator.userAgent}`,
    ...Object.entries(extra).map(([k, v]) => `${k} : ${v}`),
    `Erreurs récentes (${errors.length}) :`,
    ...(errors.length ? errors : ['aucune']),
  ].join('\n');
}
