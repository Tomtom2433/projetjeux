// Survivors talk to each other, not only to the operator.
// Every exchange is triggered by the simulation state and nudges relations or trust.
import type { GameState, NodeId, SimEvent, Survivor } from './types';
import { believedThreat, clamp, pick, say, shiftTrust, zoneOf } from './core';

const rel = (a: Survivor, b: Survivor) => a.relations[b.id] ?? 50;
const bump = (a: Survivor, b: Survivor, d: number) => {
  a.relations[b.id] = clamp(rel(a, b) + d);
  b.relations[a.id] = clamp(rel(b, a) + d * 0.6);
};
const atShelter = (sv: Survivor) => sv.alive && sv.mode !== 'down' && !sv.to && sv.at === 'shelter';
const once = (s: GameState, key: string) => {
  if (s.flags['b_' + key]) return false;
  s.flags['b_' + key] = true;
  return true;
};
const alone = (sv: Survivor) => (sv.id === 'jo' ? 'seul' : 'seule');

/** Someone who cares objects when a friend is sent toward known danger. */
export function protest(s: GameState, sent: Survivor, path: NodeId[], ev: SimEvent[]) {
  let risk = 0;
  for (const n of path) risk = Math.max(risk, believedThreat(s, sent, n));
  if (risk < 3) return;
  for (const o of s.survivors) {
    if (o === sent || !o.alive || o.mode === 'down' || !o.linked || rel(o, sent) < 62) continue;
    if (!once(s, `protest_${o.id}_${sent.id}`)) continue;
    const lines: Record<string, string[]> = {
      mara: [`Opérateur, vous envoyez ${sent.short} là-dedans ? ${alone(sent) === 'seul' ? 'Seul' : 'Seule'} ?`, `${sent.short} n’est pas prêt${sent.id === 'jo' ? '' : 'e'} pour ça. Je le dis, c’est tout.`],
      jo: [`Vous envoyez ${sent.short === 'Lena' ? 'la gamine' : sent.short} au casse-pipe. C’est noté.`],
      lena: [`${sent.short}… fais attention. S’il te plaît.`],
    };
    say(s, ev, o, pick(s, lines[o.id] ?? lines.mara));
    shiftTrust(o, -1);
    return;
  }
}

/** Reaction of whoever is at the shelter when someone comes back with something. */
export function welcome(s: GameState, back: Survivor, ev: SimEvent[]) {
  const host = s.survivors.find((o) => o !== back && atShelter(o) && o.linked);
  if (!host || !once(s, `welcome_${back.id}`)) return;
  const warm = rel(host, back) >= 60;
  const lines: Record<string, [string[], string[]]> = {
    mara: [[`Montre-moi tes mains, ${back.short}. Pas de morsure ? Bien. Bon retour.`, `${back.short}. Assieds-toi, je regarde ça.`], [`Tu as mis le temps, ${back.short}. On commençait à compter.`]],
    jo: [[`Pas mal, ${back.short}. Pose ça là, je range.`, `T’es entier${back.id === 'jo' ? '' : 'e'}. C’est déjà ça.`], [`T’as pris ton temps.`]],
    lena: [[`${back.short} ! Tu es là. J’ai gardé de l’eau.`, `Je t’ai vu${back.id === 'jo' ? '' : 'e'} arriver depuis le toit. J’ai pas respiré avant le portail.`], [`…Salut, ${back.short}.`]],
  };
  const set = lines[host.id] ?? lines.mara;
  say(s, ev, host, pick(s, warm ? set[0] : set[1]));
  bump(host, back, warm ? 3 : 1);
  back.fear = clamp(back.fear - (warm ? 8 : 2));
}

export function thank(s: GameState, saved: Survivor, by: Survivor, ev: SimEvent[]) {
  const lines: Record<string, string> = {
    mara: `…${by.short}. Tu m’as portée tout ce chemin. Je n’oublierai pas.`,
    jo: `…${by.short}. Je te dois une vie. Me le rappelle pas trop souvent.`,
    lena: `…${by.short} ? Tu es venu${by.id === 'jo' ? '' : 'e'} me chercher. Tu es venu${by.id === 'jo' ? '' : 'e'}.`,
  };
  say(s, ev, saved, lines[saved.id] ?? `…merci, ${by.short}.`);
}

/** A friend hears the fall over the radio. */
export function cryOut(s: GameState, fallen: Survivor, ev: SimEvent[]) {
  const o = s.survivors.find((x) => x !== fallen && x.alive && x.mode !== 'down' && x.linked && rel(x, fallen) >= 60);
  if (!o) return;
  const lines: Record<string, string> = {
    mara: `${fallen.short} ! Réponds-moi ! Opérateur, donnez-moi sa position !`,
    jo: `${fallen.short} ? ${fallen.short} ! Bordel. Dites-moi où.`,
    lena: `${fallen.short} ?! Non non non— ${fallen.short} !`,
  };
  say(s, ev, o, lines[o.id], 'alert');
  o.fear = clamp(o.fear + 10);
}

const CHATTER: Record<string, [string, string, string, string][]> = {
  // [first speaker, line, second speaker, reply]
  'jo|mara': [
    ['jo', 'Tu lui fais confiance, toi, à la voix ?', 'mara', 'Je fais confiance à ce qu’elle nous ramène. Pour l’instant.'],
    ['mara', 'Ton épaule. Laisse-moi regarder.', 'jo', 'C’est rien. …Bon. Regarde.'],
  ],
  'lena|mara': [
    ['mara', 'Tu as mangé, Lena ?', 'lena', '…Après. Quand tout le monde sera rentré.'],
    ['lena', 'Mara ? Les caves du quai. Tu y repenses, toi ?', 'mara', 'Tous les jours. C’est pour ça que tu es là.'],
  ],
  'jo|lena': [
    ['jo', 'Tiens. Tourne dans ce sens pour serrer. Voilà. T’apprends vite.', 'lena', 'Mon père disait pareil. …Merci, Jo.'],
    ['lena', 'Jo, ton frère… il était comment ?', 'jo', 'Plus drôle que moi. Il conduisait trop vite. Va dormir.'],
  ],
};

export function tickBanter(s: GameState, ev: SimEvent[]) {
  // 1. Worry about someone who has been off the air too long.
  for (const lost of s.survivors) {
    if (!lost.alive || lost.linked || s.time - lost.lastReport.time < 45) continue;
    const o = s.survivors.find((x) => x !== lost && atShelter(x) && rel(x, lost) >= 60);
    if (!o || !once(s, `worry_${lost.id}`)) continue;
    const lines: Record<string, string> = {
      mara: `Toujours rien de ${lost.short} ? Ça fait trop longtemps.`,
      jo: `${lost.short} répond plus. J’aime pas ça.`,
      lena: `Pourquoi ${lost.short} ne répond pas ? Opérateur ? Pourquoi ?`,
    };
    say(s, ev, o, lines[o.id]);
    o.fear = clamp(o.fear + 6);
  }
  // 2. Quiet talk between two people waiting at the shelter.
  if (s.time < 70 || Math.floor(s.time) % 20 !== 0) return;
  const home = s.survivors.filter((o) => atShelter(o) && o.mode === 'idle' && o.linked);
  if (home.length < 2) return;
  const [a, b] = home;
  const key = [a.id, b.id].sort().join('|');
  const pool = CHATTER[key];
  if (!pool) return;
  const n = (s.flags['chat_' + key] as number) ?? 0;
  if (n >= 1 || s.time - ((s.flags.lastChat as number) ?? -999) < 90) return;
  const day = (s.persistent['chat_' + key] as number) ?? 0;
  const [sa, la, sb, lb] = pool[day % pool.length];
  s.flags['chat_' + key] = n + 1;
  s.flags.lastChat = s.time;
  s.persistent['chat_' + key] = day + 1;
  const A = s.survivors.find((x) => x.id === sa)!;
  const B = s.survivors.find((x) => x.id === sb)!;
  say(s, ev, A, la);
  say(s, ev, B, lb);
  bump(A, B, 3);
  void zoneOf;
}
