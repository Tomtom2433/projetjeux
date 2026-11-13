// Training day ("Prise de poste"), led by Mara over the radio.
// Each step is one line from her and one thing to do; the step completes when the player really does it.
// While a step is on screen the simulation is frozen, except the "watch" steps where the point is to see it run.
import type { NodeId } from '../sim/types';
import { NODE } from '../sim/world';
import type { GameApi } from './ui';

type Target = string | { node: NodeId } | null;

interface Step {
  /** What Mara says. */
  say: string;
  /** What the player has to do. */
  todo: string;
  target?: (g: GameApi) => Target;
  /** Completes by itself when true. Without it the player confirms with a button. */
  done?: (g: GameApi, enter: Enter) => boolean;
  /** What « Suivant » does when the player would rather not do it by hand: the action is carried out for them. */
  auto?: (g: GameApi) => void;
  /** The simulation keeps running while this step is shown. */
  live?: boolean;
  /** Label of the confirm button, when there is one. */
  button?: string;
  /** The confirm button also ends the training day. */
  ends?: boolean;
}

interface Enter {
  x: number;
  z: number;
  zoom: number;
}

const KEY = 'last-signal.tuto';
const sv = (g: GameApi, id: string) => g.s.survivors.find((v) => v.id === id);
const chip = (id: string) => `[data-act="select"][data-arg="${id}"]`;
const orderBtn = (type: string) => `[data-act="order"][data-arg="${type}"]`;

/** Walks the player through "select, order, destination, transmit" for one survivor. */
function orderFlow(g: GameApi, id: string, type: string, node: NodeId | null): Target {
  if (g.selected !== id) return chip(id);
  if (g.orderType !== type) return orderBtn(type);
  if (!g.chosen) return node ? { node } : null;
  return '[data-act="confirm"]';
}

const victimNode = (g: GameApi): NodeId | null => {
  const v = g.s.survivors.find((x) => x.id === g.s.flags.tut_victim);
  return v && v.mode === 'down' ? v.at : null;
};

const STEPS: Step[] = [
  {
    say: 'Opérateur, ici Mara. On commence doucement. Regardez d’abord où vous êtes : l’abri, l’avenue, le canal.',
    todo: 'Glissez sur la carte pour la déplacer. Pincez (ou molette) pour zoomer.',
    done: (g, e) => Math.hypot(g.view().x - e.x, g.view().z - e.z) > 5 || Math.abs(g.view().zoom - e.zoom) > 2.5,
  },
  {
    say: 'Je vous présente Lena. Elle court vite et on ne l’entend pas. Elle a peur de tout, et elle a souvent raison.',
    todo: 'Touchez <b>Lena</b> dans la liste à gauche.',
    target: () => chip('lena'),
    done: (g) => g.selected === 'lena',
    auto: (g) => g.select('lena'),
  },
  {
    say: 'Personne n’a regardé le bout de l’avenue depuis hier. Envoyez-la voir. Vous ne la déplacez pas : vous lui demandez.',
    todo: 'Touchez l’ordre <b>Reconnaître</b>, puis l’anneau du <b>Carrefour du quai</b>, puis <b>Transmettre</b>.',
    target: (g) => orderFlow(g, 'lena', 'scout', 'cross_w'),
    done: (g) => !!sv(g, 'lena')?.order,
    auto: (g) => g.orderNow('lena', 'scout', 'cross_w'),
  },
  {
    say: 'Regardez-la partir. Elle choisit son chemin, et elle vous raconte ce qu’elle voit. Le reste de la ville, vous ne le voyez pas.',
    todo: 'Attendez son rapport. Le bouton <b>×1</b> accélère le temps.',
    target: () => '[data-act="speed"]',
    live: true,
    done: (g) => !!g.s.flags.scouted_cross_w,
    auto: (g) => g.advanceUntil(() => !!g.s.flags.scouted_cross_w, 120),
  },
  {
    say: 'Voilà. Ce qu’elle voit, vous le voyez. « ☣ 2 · hier », au checkpoint, c’est ce qu’on croyait hier. Un renseignement vieillit. Méfiez-vous des vieux.',
    todo: 'Les zones sombres sont sans nouvelles. Les étiquettes en pointillés sont des renseignements périmés.',
  },
  {
    say: 'Il y a une camionnette abandonnée au quai sud. Jo porte lourd et fouille vite. Demandez-lui, il râlera, il ira.',
    todo: 'Touchez <b>Jo</b>, l’ordre <b>Récupérer</b>, l’anneau du <b>Quai sud</b>, puis <b>Transmettre</b>.',
    target: (g) => orderFlow(g, 'jo', 'retrieve', 'quay_s'),
    done: (g) => g.s.survivors.some((v) => v.order?.type === 'retrieve') || g.s.delivered.supplies >= 1,
    auto: (g) => g.orderNow('jo', 'retrieve', 'quay_s'),
  },
  {
    say: 'Les pastilles sous chaque ordre, c’est ce que chacun sait faire. Jo fouille mieux que personne. Lena observe. Moi, je ramène les gens.',
    todo: 'Lena tient le carrefour : tant qu’elle regarde, Jo est <b>couvert</b> (pointillés bleus). Agir sous couverture fait monter la <b>Synchro</b>. Attendez son retour.',
    live: true,
    done: (g) => g.s.delivered.supplies >= 1,
    auto: (g) => g.advanceUntil(() => g.s.delivered.supplies >= 1, 240),
  },
  {
    say: 'Quelqu’un est tombé. Sa balise émet. C’est pour ça que je suis là : envoyez-moi.',
    todo: 'Touchez <b>Mara</b>, l’ordre <b>Secourir</b>, l’anneau de la balise, puis <b>Transmettre</b>.',
    target: (g) => (victimNode(g) ? orderFlow(g, 'mara', 'rescue', victimNode(g)) : null),
    done: (g) => !!g.s.flags.tut_rescued || g.s.survivors.some((v) => v.order?.type === 'rescue' || !!v.helping),
    auto: (g) => {
      g.advanceUntil(() => !!victimNode(g) || !!g.s.flags.tut_rescued, 120);
      const n = victimNode(g);
      if (n) g.orderNow('mara', 'rescue', n);
    },
  },
  {
    say: 'J’y vais. Gardez un œil sur nos jauges : ♥ santé, ϟ stress, ☾ fatigue. Quelqu’un d’effrayé, ou qui ne vous fait plus confiance, peut vous dire non.',
    todo: 'Attendez que tout le monde soit rentré à l’abri.',
    target: () => '#team',
    live: true,
    done: (g) => !!g.s.flags.tut_rescued,
    auto: (g) => g.advanceUntil(() => !!g.s.flags.tut_rescued, 300),
  },
  {
    say: 'Dernière chose. Là où la radio ne porte pas, on décide sans vous, et vous l’apprenez après. Avec deux pièces, l’antenne porte plus loin.',
    todo: 'Ouvrez <b>Abri</b> et améliorez l’<b>Antenne</b>. Facultatif.',
    target: () => '[data-act="open"][data-arg="shelter"]',
    done: (g) => g.s.shelter.antenna >= 1,
  },
  {
    say: 'Vous savez l’essentiel. Quand la radio sonne, le temps s’arrête et la décision est la vôtre. Demain, c’est Saint-Roch, et ce ne sera pas un exercice.',
    todo: 'La formation est terminée.',
    button: 'Terminer la formation',
    ends: true,
  },
];

export class Tutorial {
  index = -1;
  private enter: Enter = { x: 0, z: 0, zoom: 0 };
  private panel = document.getElementById('coach')!;
  private ring = document.getElementById('tut-ring')!;
  private shown = '';

  constructor(private g: GameApi) {}

  static seen(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return true;
    }
  }

  static reset() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  static markSeen() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
  }

  /** True while a step is displayed and the clock must not run. */
  get holding(): boolean {
    return this.index >= 0 && !STEPS[this.index].live;
  }

  /** Called whenever a day begins or a save is resumed. Only the training day is guided. */
  maybeStart() {
    this.index = -1;
    this.shown = '';
    if (this.g.s.day !== 0 || this.g.s.phase !== 'running') return;
    // resume at the first step that is not already satisfied (a reloaded save)
    let i = 0;
    while (i < STEPS.length - 1 && i > 0 && STEPS[i].done?.(this.g, this.enter)) i++;
    if (this.g.s.flags.scouted_cross_w) i = Math.max(i, 5);
    if (this.g.s.delivered.supplies >= 1) i = Math.max(i, 7);
    if (this.g.s.flags.tut_rescued) i = Math.max(i, 9);
    this.index = i;
  }

  private go(i: number) {
    if (i >= STEPS.length) return this.finish();
    this.index = i;
    this.shown = '';
  }

  /** The confirm button of the current step. */
  next() {
    if (this.index < 0) return;
    const step = STEPS[this.index];
    if (step.ends) {
      this.finish();
      this.g.endDayNow();
      return;
    }
    // « Suivant » carries out the step for the player, then moves on
    if (step.done && !step.done(this.g, this.enter)) step.auto?.(this.g);
    this.go(this.index + 1);
  }

  finish() {
    this.index = -1;
    this.shown = '';
    this.panel.hidden = true;
    this.ring.hidden = true;
    Tutorial.markSeen();
  }

  /** Per frame: completion check, card, and the spotlight on what to touch. */
  frame(visible: boolean) {
    if (this.index < 0 || !visible) {
      if (!this.panel.hidden) this.panel.hidden = true;
      if (!this.ring.hidden) this.ring.hidden = true;
      this.shown = '';
      return;
    }
    const step = STEPS[this.index];
    const key = String(this.index);
    if (this.shown === key && step.done?.(this.g, this.enter)) {
      this.go(this.index + 1);
      return;
    }
    if (this.shown !== key) {
      this.shown = key;
      const v = this.g.view();
      this.enter = { x: v.x, z: v.z, zoom: v.zoom };
      this.panel.hidden = false;
      this.panel.className = 'tut';
      const btn = step.button ?? 'Suivant ▸';
      this.panel.innerHTML = `<div class="tp"><div class="pimg" style="background-image:url(./art/p-mara.webp)"></div></div>
        <div class="tb"><small>Formation ${this.index + 1}/${STEPS.length} · Mara</small><p class="say">« ${step.say} »</p><p class="todo">${step.todo}</p></div>
        <div class="acts"><button class="btn primary" data-act="tut-next">${btn}</button></div>`;
    }
    const target = step.target?.(this.g) ?? null;
    let rect: { x: number; y: number; w: number; h: number; round: boolean } | null = null;
    if (target && typeof target === 'object') {
      const p = this.g.project(NODE[target.node].x, NODE[target.node].z);
      rect = { x: p.x - 26, y: p.y - 22, w: 52, h: 52, round: true };
    } else if (typeof target === 'string') {
      const el = document.querySelector<HTMLElement>(target);
      if (el && el.offsetParent !== null) {
        const r = el.getBoundingClientRect();
        rect = { x: r.left - 5, y: r.top - 5, w: r.width + 10, h: r.height + 10, round: false };
      }
    }
    if (!rect) {
      this.ring.hidden = true;
      return;
    }
    this.ring.hidden = false;
    this.ring.className = rect.round ? 'round' : '';
    this.ring.style.transform = `translate3d(${rect.x.toFixed(0)}px,${rect.y.toFixed(0)}px,0)`;
    this.ring.style.width = `${rect.w.toFixed(0)}px`;
    this.ring.style.height = `${rect.h.toFixed(0)}px`;
  }
}
