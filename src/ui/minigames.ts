// Short hands-on trials the operator can play to help a survivor. Each returns a score from 0 to 1.
// They run on their own clock, over the paused game, and are always optional.
export type MiniKind = 'scout' | 'retrieve' | 'rescue' | 'signal';

interface Text {
  title: string;
  say: string;
  good: string;
  mid: string;
  bad: string;
}
export const MINI_TEXT: Record<MiniKind, Text> = {
  scout: {
    title: 'Balayage aux jumelles',
    say: '{n} balaie la rue. Touchez les silhouettes <b class="t-bad">rouges</b> avant qu’elles disparaissent. Pas les <b class="t-ok">bleues</b> : ce sont des vivants.',
    good: 'Tout est compté. Elle lit la rue d’un coup d’œil, et les rues voisines avec.',
    mid: 'Une partie lui a échappé, mais elle gagne du temps.',
    bad: 'Trop de brume, pas assez d’yeux. Elle fera sans vous.',
  },
  retrieve: {
    title: 'Crochetage',
    say: '{n} force une serrure. Elle cède par crans : touchez quand le repère passe sur le cran.',
    good: 'Ouvert sans un bruit. La fouille ira beaucoup plus vite.',
    mid: 'Ça finit par céder. Un peu de temps gagné.',
    bad: 'Le crochet a ripé. La fouille prendra son temps.',
  },
  rescue: {
    title: 'Garrot',
    say: 'Guidez {n} par radio. Maintenez appuyé pour serrer, relâchez quand la jauge est dans la zone. Trop serré, c’est raté.',
    good: 'Serré juste ce qu’il faut. Le blessé reviendra à lui en bien meilleur état.',
    mid: 'Pas parfait, mais ça tient. Ça aidera.',
    bad: 'Raté. Les gestes seront les siens, pas les vôtres.',
  },
  signal: {
    title: 'Accorder la fréquence',
    say: 'La liaison avec {n} est tombée. Faites glisser le curseur jusqu’à superposer votre onde à la sienne, et tenez-la.',
    good: 'Liaison rétablie pour une demi-minute. Parlez vite.',
    mid: 'Un filet de voix dans le souffle. Quelques secondes, pas plus.',
    bad: 'Rien que de la neige. Il faudra attendre qu’elle se rapproche.',
  },
};

export class MiniGames {
  active = false;
  private el: HTMLDivElement;
  private raf = 0;
  private stop: (() => void) | null = null;

  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'mini';
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  start(kind: MiniKind, name: string, done: (score: number) => void) {
    const T = MINI_TEXT[kind];
    this.active = true;
    this.el.hidden = false;
    this.el.innerHTML = `<div class="sheet mg"><header><h2>${T.title}</h2><small>${name}</small></header>
      <div class="body"><p class="mg-say">${T.say.replace('{n}', name)}</p>${kind === 'scout' ? '' : `<div class="mg-pic" style="background-image:url(./art/mg-${kind}.webp)"></div>`}<div class="mg-area mg-${kind}"></div><p class="mg-res"></p></div>
      <div class="actions"><button class="btn ghost" data-mg="skip">Laisser faire</button><button class="btn primary" data-mg="ok" hidden>Continuer</button></div></div>`;
    const area = this.el.querySelector('.mg-area') as HTMLDivElement;
    const res = this.el.querySelector('.mg-res') as HTMLParagraphElement;
    const ok = this.el.querySelector('[data-mg="ok"]') as HTMLButtonElement;
    const skip = this.el.querySelector('[data-mg="skip"]') as HTMLButtonElement;
    let score = 0;
    let over = false;
    const close = (s: number) => {
      cancelAnimationFrame(this.raf);
      this.stop?.();
      this.stop = null;
      this.active = false;
      this.el.hidden = true;
      this.el.innerHTML = '';
      done(s);
    };
    const finish = (s: number) => {
      if (over) return;
      over = true;
      score = Math.min(1, Math.max(0, s));
      cancelAnimationFrame(this.raf);
      this.stop?.();
      this.stop = null;
      area.classList.add('over');
      res.textContent = score >= 0.7 ? T.good : score >= 0.3 ? T.mid : T.bad;
      res.className = 'mg-res ' + (score >= 0.7 ? 'good' : score >= 0.3 ? 'mid' : 'bad');
      navigator.vibrate?.(score >= 0.7 ? 30 : [30, 50, 30]);
      skip.hidden = true;
      ok.hidden = false;
    };
    ok.onclick = () => close(score);
    skip.onclick = () => close(0);
    const loop = (tick: (dt: number, t: number) => void) => {
      let last = performance.now();
      const t0 = last;
      const step = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (over) return;
        tick(dt, (now - t0) / 1000);
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    };
    ({ scout: sweep, retrieve: lock, rescue: tourniquet, signal: tune })[kind](area, res, loop, finish, (fn) => (this.stop = fn));
  }
}

type Loop = (tick: (dt: number, t: number) => void) => void;
type Game = (area: HTMLDivElement, res: HTMLParagraphElement, loop: Loop, finish: (score: number) => void, onStop: (fn: () => void) => void) => void;

/** Tap the infected as they show through the fog; leave the living alone. */
const sweep: Game = (area, res, loop, finish) => {
  const total = 7;
  const plan: { at: number; bad: boolean; x: number; y: number }[] = [];
  for (let i = 0; i < total; i++) plan.push({ at: 0.5 + i * 1.0 + Math.random() * 0.35, bad: true, x: 0.08 + Math.random() * 0.8, y: 0.12 + Math.random() * 0.6 });
  for (let i = 0; i < 2; i++) plan.push({ at: 1.6 + i * 3.1 + Math.random(), bad: false, x: 0.08 + Math.random() * 0.8, y: 0.12 + Math.random() * 0.6 });
  plan.sort((a, b) => a.at - b.at);
  let next = 0;
  let hits = 0;
  let wrong = 0;
  const live: { el: HTMLElement; until: number }[] = [];
  res.textContent = `0 / ${total}`;
  loop((_dt, t) => {
    while (next < plan.length && t >= plan[next].at) {
      const p = plan[next++];
      const el = document.createElement('button');
      el.className = 'mg-t ' + (p.bad ? 'bad' : 'ok');
      el.style.left = `${(p.x * 100).toFixed(1)}%`;
      el.style.top = `${(p.y * 100).toFixed(1)}%`;
      el.onpointerdown = (e) => {
        e.preventDefault();
        if (el.dataset.done) return;
        el.dataset.done = '1';
        el.classList.add('hit');
        if (p.bad) hits++;
        else wrong++;
        res.textContent = `${hits} / ${total}${wrong ? ` · ${wrong} erreur${wrong > 1 ? 's' : ''}` : ''}`;
      };
      area.appendChild(el);
      // later silhouettes linger a little less
      live.push({ el, until: t + 1.25 - Math.min(0.4, next * 0.04) });
    }
    for (const l of live) if (t > l.until && !l.el.dataset.gone) {
      l.el.dataset.gone = '1';
      l.el.classList.add('gone');
    }
    if (next >= plan.length && live.every((l) => t > l.until + 0.25)) finish((hits - wrong * 1.5) / total);
  });
};

/** A cursor sweeps the bar: tap when it is on the notch. Three notches, each narrower and faster. */
const lock: Game = (area, res, loop, finish) => {
  area.innerHTML = '<i class="mg-zone"></i><i class="mg-cur"></i><div class="mg-dots"><i></i><i></i><i></i></div>';
  const zone = area.querySelector('.mg-zone') as HTMLElement;
  const cur = area.querySelector('.mg-cur') as HTMLElement;
  const dots = [...area.querySelectorAll('.mg-dots i')] as HTMLElement[];
  let pos = 0, dir = 1, speed = 0.75, round = 0, wait = 0;
  let z: [number, number] = [0.52, 0.76];
  const hits: number[] = [];
  const place = () => {
    zone.style.left = `${z[0] * 100}%`;
    zone.style.width = `${(z[1] - z[0]) * 100}%`;
  };
  place();
  res.textContent = 'Touchez la barre quand le repère est sur le cran.';
  area.onpointerdown = (e) => {
    e.preventDefault();
    if (wait > 0 || round >= 3) return;
    const mid = (z[0] + z[1]) / 2, half = (z[1] - z[0]) / 2, off = Math.abs(pos - mid);
    const h = off <= half ? 1 - (off / half) * 0.4 : off <= half * 1.6 ? 0.3 : 0;
    hits.push(h);
    dots[round].className = h > 0.5 ? 'ok' : h > 0 ? 'mid' : 'bad';
    round++;
    if (round >= 3) return finish(hits.reduce((a, b) => a + b, 0) / 3);
    speed += 0.3;
    const w = 0.24 - round * 0.05;
    const start = 0.12 + Math.random() * 0.6;
    z = [start, start + w];
    place();
    wait = 0.3;
  };
  loop((dt) => {
    wait = Math.max(0, wait - dt);
    pos += dir * speed * dt;
    if (pos > 1) { pos = 1; dir = -1; }
    if (pos < 0) { pos = 0; dir = 1; }
    cur.style.left = `${pos * 100}%`;
  });
};

/** Hold to tighten, let go inside the band. Twice; overshoot and it is lost. */
const tourniquet: Game = (area, res, loop, finish, onStop) => {
  area.innerHTML = '<div class="mg-gauge"><i class="mg-zone"></i><i class="mg-fill"></i></div><button class="btn mg-hold">Maintenir pour serrer</button><div class="mg-dots"><i></i><i></i></div>';
  const zone = area.querySelector('.mg-zone') as HTMLElement;
  const fill = area.querySelector('.mg-fill') as HTMLElement;
  const hold = area.querySelector('.mg-hold') as HTMLButtonElement;
  const dots = [...area.querySelectorAll('.mg-dots i')] as HTMLElement[];
  let v = 0, down = false, round = 0, rate = 0.55, wait = 0;
  let z: [number, number] = [0.6, 0.78];
  const hits: number[] = [];
  const place = () => {
    zone.style.left = `${z[0] * 100}%`;
    zone.style.width = `${(z[1] - z[0]) * 100}%`;
  };
  place();
  res.textContent = 'Relâchez quand la jauge est dans la zone.';
  const judge = (burst: boolean) => {
    const mid = (z[0] + z[1]) / 2, half = (z[1] - z[0]) / 2, off = Math.abs(v - mid);
    const h = burst ? 0 : off <= half ? 1 - (off / half) * 0.3 : off <= half * 2 ? 0.35 : 0;
    hits.push(h);
    dots[round].className = h > 0.5 ? 'ok' : h > 0 ? 'mid' : 'bad';
    round++;
    down = false;
    if (round >= 2) return finish((hits[0] + hits[1]) / 2);
    v = 0;
    rate = 0.85;
    const start = 0.35 + Math.random() * 0.4;
    z = [start, start + 0.13];
    place();
    wait = 0.4;
  };
  const press = (e: Event) => {
    e.preventDefault();
    if (wait <= 0 && round < 2) down = true;
  };
  const release = () => {
    if (down) judge(false);
  };
  hold.addEventListener('pointerdown', press);
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  onStop(() => {
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
  });
  loop((dt) => {
    wait = Math.max(0, wait - dt);
    if (down) {
      v += rate * dt;
      if (v >= 1) {
        v = 1;
        judge(true);
      }
    }
    fill.style.width = `${v * 100}%`;
  });
};

/** Slide your wave onto the survivor's and hold it there. */
const tune: Game = (area, res, loop, finish) => {
  area.innerHTML = '<canvas width="560" height="150"></canvas><input type="range" min="0" max="1000" value="80" aria-label="Fréquence">';
  const cv = area.querySelector('canvas') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  const input = area.querySelector('input') as HTMLInputElement;
  const target = 0.3 + Math.random() * 0.55;
  let held = 0;
  const limit = 14;
  loop((dt, t) => {
    const mine = Number(input.value) / 1000;
    const diff = Math.abs(mine - target);
    const lock = diff < 0.035;
    held = lock ? held + dt : Math.max(0, held - dt * 0.5);
    g.clearRect(0, 0, cv.width, cv.height);
    const wave = (f: number, color: string, amp: number, noise: number) => {
      g.beginPath();
      for (let x = 0; x <= cv.width; x += 4) {
        const y = cv.height / 2 + Math.sin(x * (0.012 + f * 0.06) + t * 5) * amp + (Math.random() - 0.5) * noise;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.stroke();
    };
    wave(target, 'rgba(242,197,124,0.9)', 42, 5);
    wave(mine, lock ? '#3fe0c5' : 'rgba(159,176,212,0.9)', 42, Math.min(26, diff * 90));
    res.textContent = lock ? `Accroché… ${(1.5 - held).toFixed(1)} s` : `Temps restant : ${Math.max(0, limit - t).toFixed(0)} s`;
    if (held >= 1.5) return finish(1 - (t / limit) * 0.35);
    if (t >= limit) finish(diff < 0.1 ? 0.4 : 0);
  });
};
