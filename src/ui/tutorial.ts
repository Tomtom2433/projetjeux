// Guided first day. Each step waits for the player to actually do the thing;
// the simulation is frozen while a step is on screen, so the clock never punishes reading.
import type { GameApi } from './ui';

interface Step {
  title: string;
  text: string;
  /** CSS selector of the HUD element to spotlight. */
  target?: string;
  /** Step completes by itself when this returns true. Without it, the player taps "Compris". */
  done?: (g: GameApi, enter: Enter) => boolean;
  /** The simulation keeps running while this step is shown. */
  live?: boolean;
}

interface Enter {
  x: number;
  z: number;
  zoom: number;
}

const KEY = 'last-signal.tuto';

const STEPS: Step[] = [
  {
    title: 'La carte',
    text: 'Glissez pour déplacer la caméra. Pincez (ou molette) pour zoomer. Essayez.',
    done: (g, e) => Math.hypot(g.view().x - e.x, g.view().z - e.z) > 5 || Math.abs(g.view().zoom - e.zoom) > 2.5,
  },
  {
    title: 'Votre équipe',
    text: 'Trois survivants, trois caractères. Touchez <b>Lena</b>, l’éclaireuse : rapide, discrète, mais anxieuse.',
    target: '[data-act="select"][data-arg="lena"]',
    done: (g) => g.selected === 'lena',
  },
  {
    title: 'Donner un ordre',
    text: 'Vous ne déplacez personne : vous <b>demandez</b>. Choisissez <b>Reconnaître</b>.',
    target: '[data-act="order"][data-arg="scout"]',
    done: (g) => g.orderType === 'scout' || !!g.s.survivors.find((v) => v.id === 'lena')?.order,
  },
  {
    title: 'Choisir la destination',
    text: 'Touchez un anneau turquoise sur la carte, par exemple le <b>Carrefour du quai</b>, puis <b>Transmettre</b>.',
    target: '[data-act="confirm"]',
    done: (g) => !!g.s.survivors.find((v) => v.id === 'lena')?.order,
  },
  {
    title: 'Ce que vous savez vraiment',
    live: true,
    text: 'Vous ne voyez que ce que vos survivants rapportent. Les zones sombres sont sans nouvelles. « ☣ 2 · hier » est un renseignement <b>périmé</b> : la réalité a pu changer.',
  },
  {
    title: 'L’objectif du jour',
    text: 'Envoyez <b>Mara</b> chercher les médicaments : touchez Mara, <b>Récupérer</b>, <b>Hôpital Saint-Roch</b>. Avant de transmettre, lisez le résumé : distance, menaces connues, zones sans signal.',
    target: '[data-act="select"][data-arg="mara"]',
    done: (g) => g.s.survivors.find((v) => v.id === 'mara')?.order?.type === 'retrieve',
  },
  {
    title: 'Le signal',
    text: 'L’hôpital est hors réseau : là-bas, Mara décidera <b>sans vous</b>, et ses rapports arriveront en retard. Ouvrez <b>Abri</b> pour améliorer l’antenne (vous avez 2 pièces). Facultatif.',
    target: '[data-act="open"][data-arg="shelter"]',
    done: (g) => g.s.shelter.antenna >= 1,
  },
  {
    title: 'Ils ne sont pas des pions',
    text: '<b>♥</b> santé · <b>ϟ</b> stress · <b>☾</b> fatigue. Un survivant effrayé ou qui ne vous fait plus confiance peut refuser, fuir ou rentrer de lui-même. Tout le monde doit être à l’abri avant la nuit.',
    target: '#team',
  },
  {
    title: 'La radio',
    text: 'Quand un survivant vous appelle, le temps s’arrête : la décision est la vôtre, et elle a des suites. Bonne chance, opérateur.',
    target: '[data-act="open"][data-arg="radio"]',
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

  /** True while a step is displayed: the game loop keeps the simulation frozen. */
  get holding(): boolean {
    return this.index >= 0 && !STEPS[this.index].live;
  }

  /** Called when a fresh day 1 begins. */
  maybeStart() {
    if (Tutorial.seen() || this.g.s.day !== 1 || this.g.s.time > 3) {
      this.index = -1;
      return;
    }
    this.go(0);
  }

  private go(i: number) {
    if (i >= STEPS.length) return this.finish();
    this.index = i;
    const v = this.g.view();
    this.enter = { x: v.x, z: v.z, zoom: v.zoom };
    this.shown = '';
  }

  next() {
    if (this.index >= 0) this.go(this.index + 1);
  }

  finish() {
    this.index = -1;
    this.shown = '';
    this.panel.hidden = true;
    this.ring.hidden = true;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
  }

  /** Per-frame: check completion, draw the card and the spotlight. */
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
      // measure camera movement from the moment the card appears, not from an earlier scripted pan
      const v = this.g.view();
      this.enter = { x: v.x, z: v.z, zoom: v.zoom };
      this.panel.hidden = false;
      this.panel.className = 'tut';
      this.panel.innerHTML = `<small>Tutoriel ${this.index + 1}/${STEPS.length} · ${step.title}</small><div class="row"><p>${step.text}</p><div class="acts"><button class="btn ghost" data-act="tut-skip">Passer</button>${step.done && this.index !== 6 ? '' : `<button class="btn primary" data-act="tut-next">${this.index === STEPS.length - 1 ? 'Commencer' : this.index === 6 ? 'Plus tard' : 'Compris'}</button>`}</div></div>`;
    }
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (!el || el.offsetParent === null) {
      this.ring.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    this.ring.hidden = false;
    this.ring.style.transform = `translate3d(${(r.left - 5).toFixed(0)}px,${(r.top - 5).toFixed(0)}px,0)`;
    this.ring.style.width = `${(r.width + 10).toFixed(0)}px`;
    this.ring.style.height = `${(r.height + 10).toFixed(0)}px`;
  }
}
