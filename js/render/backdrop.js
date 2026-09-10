/* =============================================================================
 *  galabob — BACKDROP : thèmes de fond, planètes néon, événements célestes
 * -----------------------------------------------------------------------------
 *  LE PROBLÈME : le fond était joli mais toujours identique. Dix stages, un
 *  seul ciel. Ce module donne à chaque stage son propre CIEL, avec :
 *
 *    1. DIX THÈMES  — nébuleuse, teinte/densité des étoiles, corps céleste
 *       dominant et SIGNATURE (brume, poussière, cristaux, braises, neige…).
 *       Ils doivent être reconnaissables au premier coup d'œil.
 *    2. DES PLANÈTES EN NÉON VECTORIEL — jamais de sphère texturée : un disque
 *       SOMBRE, un ARC LUMINEUX sur le terminateur, un fil de fer de latitudes
 *       à peine visible, des anneaux en ellipses lumineuses, des lunes en
 *       orbite lente. Elles vivent sur le plan le plus lointain et dérivent à
 *       peine : c'est cette lenteur qui donne l'échelle.
 *    3. CINQ ÉVÉNEMENTS ALÉATOIRES — comète, pluie de météores, éclipse,
 *       tempête magnétique, aurore. De loin en loin, jamais prévisibles.
 *    4. UN FOND QUI RÉAGIT — BACKDROP.pulse() aux explosions,
 *       BACKDROP.setIntensity() quand l'action monte, virage au ROUGE quand il
 *       ne reste qu'une vie.
 *
 *  PERFORMANCE — LA RÈGLE ABSOLUE
 *  ------------------------------
 *  Le fond était déjà le poste de rendu le plus lourd du jeu. Tout ce qui est
 *  statique est PRÉ-RENDU sur un canvas hors-écran et affiché en drawImage :
 *    • la nébuleuse du thème (1/3 de résolution, 2 blits) ;
 *    • la nébuleuse « danger » rouge (construite une fois par taille) ;
 *    • la planète et ses anneaux (redessinés SEULEMENT si l'échelle change) ;
 *    • les sprites de signature, de bande et de voile d'aurore.
 *  Les seuls tracés vectoriels par frame sont les lunes, les faisceaux, la
 *  comète, les météores et le liseré d'éclipse : quelques dizaines de traits.
 *  Les reconstructions coûteuses sont ÉTALÉES (une par frame, cf. S.pending) :
 *  un changement de thème ne provoque jamais un pic de plusieurs millisecondes.
 *
 *  UNITÉS : vitesses en px CSS/seconde, durées en SECONDES dans ce module
 *  (l'API publique update(dt) reçoit des SECONDES), animations sur FRAME.time.
 *
 *  API PUBLIQUE
 *  ------------
 *    BACKDROP.setTheme(i)            i = 0..9 (modulo). Cross-fade de ~0,9 s.
 *    BACKDROP.setStage(n)            n = 1..10 → thème n-1.
 *    BACKDROP.update(dt)             dt en SECONDES.
 *    BACKDROP.draw(ctx)              tout le fond (deep + front).
 *    BACKDROP.drawDeep(ctx)          nébuleuse/aurore/brume — SOUS les étoiles.
 *    BACKDROP.drawFront(ctx)         planète/particules/événements — SUR elles.
 *    BACKDROP.pulse(couleur, force)  onde de couleur (explosions).
 *    BACKDROP.setIntensity(0..1)     tension de l'action.
 *    BACKDROP.setDanger(0..1)        virage au rouge (auto si 1 vie restante).
 *    BACKDROP.trigger(nom)           'comet'|'meteors'|'eclipse'|'storm'|'aurora'
 *    BACKDROP.starStyle()            teinte/densité d'étoiles du thème (stars.js)
 *    BACKDROP.styleVersion()         change quand les couches doivent être refaites
 *    BACKDROP.warpBoost()            accélération demandée au champ d'étoiles
 *    BACKDROP.dim()                  assombrissement du ciel (éclipse)
 *    BACKDROP.handlesNebula()        true → stars.js n'affiche plus la sienne
 *
 *  Ce module ne modifie AUCUN autre fichier. stars.js l'appelle s'il existe ;
 *  s'il est absent, le fond stellaire fonctionne exactement comme avant.
 * ========================================================================== */

const BACKDROP = (function () {
  'use strict';

  const TAU = Math.PI * 2;

  /* ------------------------------------------------------------- outils */

  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }
  function smooth(t) { t = cl(t, 0, 1); return t * t * (3 - 2 * t); }
  /** Amortissement indépendant du framerate : `rate` = fraction restante à 1 s. */
  function dampTo(a, b, rate, dt) { return b + (a - b) * Math.pow(rate, dt); }
  function mkCv(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  /** Triplet PALETTE à partir d'un hex, mis en cache (zéro allocation par frame). */
  const triCache = {};
  function tri(hexGlow, hexCore) {
    const k = hexGlow + '|' + (hexCore || '');
    let t = triCache[k];
    if (!t) {
      t = PALETTE.get(hexCore ? { core: hexCore, glow: hexGlow } : hexGlow);
      triCache[k] = t;
    }
    return t;
  }

  /** Points d'une ellipse (ou d'un arc d'ellipse) — l'ellipse native de Path2D
   *  n'est pas garantie partout, et on est en PRÉ-RENDU : la polyligne coûte
   *  zéro au runtime et se plie à tous les helpers NEON. */
  function ellipsePts(cx, cy, rx, ry, rot, a0, a1, steps) {
    const n = Math.max(6, steps || 40);
    const ca = Math.cos(rot || 0), sa = Math.sin(rot || 0);
    const pts = new Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      const x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      pts[i] = { x: cx + x * ca - y * sa, y: cy + x * sa + y * ca };
    }
    return pts;
  }

  /* =========================================================================
   *  LES DIX THÈMES
   * -------------------------------------------------------------------------
   *  Les teintes vivent ICI (palette.js est la source des couleurs de JEU ;
   *  les couleurs de CIEL appartiennent au ciel). Chaque thème décrit :
   *    nebula    palette et densité de la nébuleuse pré-rendue
   *    star      teinte, densité et éclat des couches d'étoiles (lu par stars.js)
   *    body      le corps céleste dominant (voir buildBody)
   *    sig       la signature atmosphérique (particules ou brume)
   *    aurora    aurore PERMANENTE éventuelle (thème polaire)
   *    evt       pondération des événements aléatoires
   * ====================================================================== */

  const THEMES = [
    /* 1 ------------------------------------------------------------------ */
    {
      key: 'azur', name: 'Berceau d\'Azur',
      nebula: { tints: ['#0b2a5e', '#12569c', '#081c42'], accents: ['#3df5ff', '#7ffcff'],
                blobs: 7, peak: 0.052, alpha: 0.74, speed: 8, squash: 0.62, filaments: 3 },
      star: { tint: '#cfeeff', mix: 0.34, density: 1.00, alpha: 1.00 },
      body: {
        kind: 'ringed', core: '#eaffff', glow: '#4fd2ff', glow2: '#a8fbff',
        x: 0.76, y: 0.26, scale: 0.24, light: -0.55, phase: 0.52,
        lat: 5, mer: 2, tilt: 0.30, ringTilt: 0.28, ringRot: -0.13,
        rings: [{ r: 1.58, ry: 0.30, w: 1.6, a: 0.55 }, { r: 1.88, ry: 0.34, w: 0.9, a: 0.30 }],
        moons: [{ orb: 2.35, sp: 0.085, size: 0.085, col: '#a8fbff', tilt: 0.34 }]
      },
      sig: { kind: 'snow', col: '#bfe9ff', count: 46, speed: 26, size: 2.6, alpha: 0.50 },
      evt: { comet: 1.2, meteors: 0.8, eclipse: 1.0, storm: 0.6, aurora: 0.9 }
    },
    /* 2 ------------------------------------------------------------------ */
    {
      key: 'ambre', name: 'Ceinture d\'Ambre',
      nebula: { tints: ['#4a2408', '#8f4c10', '#2a1305'], accents: ['#ffb03a', '#ff7a2b'],
                blobs: 6, peak: 0.050, alpha: 0.70, speed: 11, squash: 0.48, filaments: 4 },
      star: { tint: '#ffdca8', mix: 0.42, density: 0.90, alpha: 1.00 },
      body: {
        kind: 'gas', core: '#fff0d0', glow: '#ffb03a', glow2: '#ff7a2b',
        x: 0.20, y: 0.30, scale: 0.40, light: 0.75, phase: -0.22,
        lat: 9, mer: 1, tilt: 0.34, storm: { x: -0.30, y: 0.24, rx: 0.30, ry: 0.13 },
        moons: [{ orb: 1.55, sp: 0.13, size: 0.055, col: '#ffd98a', tilt: 0.26 },
                { orb: 2.10, sp: -0.072, size: 0.040, col: '#fff0d0', tilt: 0.26 }]
      },
      sig: { kind: 'dust', col: '#ffc978', count: 64, speed: 44, size: 1.9, alpha: 0.42 },
      evt: { comet: 1.0, meteors: 1.4, eclipse: 1.2, storm: 0.8, aurora: 0.3 }
    },
    /* 3 ------------------------------------------------------------------ */
    {
      key: 'pourpre', name: 'Voile Pourpre',
      nebula: { tints: ['#3a0a4e', '#7d1a90', '#20063a'], accents: ['#ff2bd6', '#9d5bff'],
                blobs: 8, peak: 0.058, alpha: 0.86, speed: 13, squash: 0.75, filaments: 5 },
      star: { tint: '#f0c8ff', mix: 0.45, density: 1.15, alpha: 1.00 },
      body: {
        kind: 'twin', core: '#ffe0ff', glow: '#c05bff', glow2: '#ff2bd6',
        x: 0.64, y: 0.22, scale: 0.155, light: -1.9, phase: 0.40,
        lat: 4, mer: 2, tilt: 0.22,
        moons: [{ orb: 3.1, sp: 0.055, size: 0.11, col: '#ff8ae8', tilt: 0.40 }]
      },
      sig: { kind: 'mist', col: '#c07bff', count: 5, speed: 16, size: 1, alpha: 0.11 },
      evt: { comet: 1.0, meteors: 0.8, eclipse: 1.4, storm: 1.3, aurora: 1.0 }
    },
    /* 4 ------------------------------------------------------------------ */
    {
      key: 'ecarlate', name: 'Forge Écarlate',
      nebula: { tints: ['#5a0a12', '#a81c14', '#280409'], accents: ['#ff2b55', '#ff7a2b'],
                blobs: 7, peak: 0.056, alpha: 0.80, speed: 15, squash: 0.52, filaments: 4 },
      star: { tint: '#ffb0a8', mix: 0.34, density: 0.82, alpha: 0.95 },
      body: {
        kind: 'volcanic', core: '#fff0e0', glow: '#ff5a2b', glow2: '#ffd166',
        x: 0.28, y: 0.70, scale: 0.34, light: 2.35, phase: 0.62,
        lat: 3, mer: 1, tilt: 0.28, cracks: 7,
        moons: [{ orb: 1.75, sp: -0.10, size: 0.06, col: '#ff9d3d', tilt: 0.30 }]
      },
      sig: { kind: 'embers', col: '#ff9d3d', count: 42, speed: 40, size: 2.5, alpha: 0.58 },
      evt: { comet: 0.8, meteors: 1.8, eclipse: 0.9, storm: 1.1, aurora: 0.3 }
    },
    /* 5 ------------------------------------------------------------------ */
    {
      key: 'emeraude', name: 'Champ d\'Émeraude',
      nebula: { tints: ['#04402c', '#0a7f56', '#03251b'], accents: ['#00ffc8', '#7dffb0'],
                blobs: 6, peak: 0.046, alpha: 0.68, speed: 10, squash: 0.66, filaments: 3 },
      star: { tint: '#c8ffe8', mix: 0.40, density: 1.00, alpha: 1.00 },
      body: {
        kind: 'crystal', core: '#eaffff', glow: '#00ffc8', glow2: '#7dffb0',
        x: 0.78, y: 0.62, scale: 0.23, light: -2.4, phase: 0.35,
        facets: 9, belt: 14, tilt: 0.30,
        moons: [{ orb: 2.4, sp: 0.10, size: 0.06, col: '#7dffd0', tilt: 0.36 }]
      },
      sig: { kind: 'crystals', col: '#7dffd0', count: 26, speed: 20, size: 6.5, alpha: 0.46 },
      evt: { comet: 1.1, meteors: 1.0, eclipse: 1.0, storm: 1.0, aurora: 1.1 }
    },
    /* 6 ------------------------------------------------------------------ */
    {
      key: 'obsidienne', name: 'Horizon Obsidienne',
      nebula: { tints: ['#0a0a1c', '#1c1038', '#050510'], accents: ['#6a4bff', '#2b6bff'],
                blobs: 5, peak: 0.034, alpha: 0.56, speed: 6, squash: 0.85, filaments: 2 },
      star: { tint: '#8ea8d8', mix: 0.30, density: 0.55, alpha: 0.82 },
      body: {
        kind: 'blackhole', core: '#ffffff', glow: '#8a6bff', glow2: '#ffd9a0',
        x: 0.50, y: 0.32, scale: 0.20, light: 0, phase: 0,
        tilt: 0.30, occlude: 0.56,
        moons: [{ orb: 3.0, sp: 0.20, size: 0.045, col: '#c0b0ff', tilt: 0.16 }]
      },
      sig: { kind: 'infall', col: '#7a6bd8', count: 54, speed: 34, size: 1.9, alpha: 0.42 },
      evt: { comet: 1.3, meteors: 0.7, eclipse: 1.6, storm: 1.2, aurora: 0.4 }
    },
    /* 7 ------------------------------------------------------------------ */
    {
      key: 'polaire', name: 'Couronne Polaire',
      nebula: { tints: ['#062c3a', '#0d5f70', '#041e2c'], accents: ['#3df5ff', '#9d5bff'],
                blobs: 6, peak: 0.042, alpha: 0.62, speed: 7, squash: 0.70, filaments: 3 },
      star: { tint: '#e8f4ff', mix: 0.26, density: 1.10, alpha: 1.00 },
      body: {
        kind: 'ice', core: '#ffffff', glow: '#8ad8ff', glow2: '#c9e9ff',
        x: 0.17, y: 0.22, scale: 0.30, light: 0.95, phase: 0.30,
        lat: 7, mer: 3, tilt: 0.36, caps: true,
        moons: [{ orb: 1.9, sp: 0.075, size: 0.07, col: '#e8f4ff', tilt: 0.42 }]
      },
      sig: { kind: 'snow', col: '#dcefff', count: 60, speed: 20, size: 2.3, alpha: 0.46 },
      aurora: { cols: ['#3df5ff', '#9d5bff', '#00ffc8'], alpha: 0.40, ribbons: 3 },
      evt: { comet: 1.0, meteors: 0.9, eclipse: 1.0, storm: 1.3, aurora: 2.2 }
    },
    /* 8 ------------------------------------------------------------------ */
    {
      key: 'solaire', name: 'Cœur Solaire',
      nebula: { tints: ['#5a3a06', '#ac760c', '#3a1e04'], accents: ['#ffd166', '#fff3d6'],
                blobs: 7, peak: 0.062, alpha: 0.82, speed: 12, squash: 0.58, filaments: 4 },
      star: { tint: '#fff0c8', mix: 0.50, density: 1.25, alpha: 1.05 },
      body: {
        kind: 'binary', core: '#ffffff', glow: '#ffd166', glow2: '#ff7a2b',
        x: 0.50, y: 0.17, scale: 0.155, light: 0, phase: 0, tilt: 0.24,
        moons: []
      },
      sig: { kind: 'sparks', col: '#ffd98a', count: 40, speed: 95, size: 5.5, alpha: 0.50 },
      evt: { comet: 0.9, meteors: 1.3, eclipse: 1.5, storm: 1.6, aurora: 0.6 }
    },
    /* 9 ------------------------------------------------------------------ */
    {
      key: 'abyssal', name: 'Récif Abyssal',
      nebula: { tints: ['#032a34', '#06636e', '#021926'], accents: ['#00ffc8', '#3df5ff'],
                blobs: 7, peak: 0.050, alpha: 0.78, speed: 9, squash: 0.72, filaments: 4 },
      star: { tint: '#a8f0ff', mix: 0.45, density: 0.95, alpha: 1.00 },
      body: {
        kind: 'ocean', core: '#eaffff', glow: '#00d8ff', glow2: '#00ffc8',
        x: 0.72, y: 0.74, scale: 0.38, light: -2.0, phase: 0.44,
        lat: 6, mer: 2, tilt: 0.26, ringTilt: 0.20, ringRot: 0.20,
        rings: [{ r: 1.66, ry: 0.20, w: 2.2, a: 0.50 }],
        moons: [{ orb: 2.05, sp: 0.065, size: 0.055, col: '#7dffe0', tilt: 0.30 },
                { orb: 2.75, sp: -0.045, size: 0.035, col: '#a8f0ff', tilt: 0.30 }]
      },
      sig: { kind: 'motes', col: '#7dffe0', count: 44, speed: 13, size: 3.6, alpha: 0.52 },
      evt: { comet: 1.1, meteors: 0.8, eclipse: 1.1, storm: 1.0, aurora: 1.5 }
    },
    /* 10 ----------------------------------------------------------------- */
    {
      key: 'singularite', name: 'Cœur de Néon',
      nebula: { tints: ['#3a0a4a', '#0a2a72', '#4a0a2a'], accents: ['#ff2bd6', '#3df5ff'],
                blobs: 9, peak: 0.066, alpha: 0.92, speed: 18, squash: 0.60, filaments: 6 },
      star: { tint: '#ffd8ff', mix: 0.30, density: 1.30, alpha: 1.05 },
      body: {
        kind: 'shattered', core: '#ffffff', glow: '#ff2bd6', glow2: '#3df5ff',
        x: 0.50, y: 0.30, scale: 0.26, light: -1.2, phase: 0.30,
        lat: 4, mer: 2, tilt: 0.30, shards: 24, beams: true,
        moons: [{ orb: 2.6, sp: 0.16, size: 0.05, col: '#3df5ff', tilt: 0.24 },
                { orb: 3.3, sp: -0.11, size: 0.04, col: '#ff8ae8', tilt: 0.24 }]
      },
      sig: { kind: 'shards', col: '#ff8ae8', count: 36, speed: 130, size: 7, alpha: 0.50 },
      evt: { comet: 1.2, meteors: 1.5, eclipse: 1.0, storm: 2.0, aurora: 1.2 }
    }
  ];

  const DANGER_COL = '#ff2b55';

  /* ========================================================================
   *  ÉTAT
   * ===================================================================== */

  const S = {
    w: 0, h: 0,
    idx: 0,
    theme: THEMES[0],
    autoStage: -1,
    manual: false,        // true : un appel explicite à setTheme() a la main

    /* pré-rendus */
    neb: null, nebPrev: null,
    body: null, bodyPrev: null,
    dangerNeb: null,
    sprites: {},          // cache de sprites (signature, bandes, voiles)
    pending: [],          // reconstructions étalées, une par frame

    /* cross-fade de thème */
    fade: 1, fading: false,
    nebOff: 0, nebPrevOff: 0,

    /* réactivité */
    intensity: 0, intensityHold: 0, intensitySet: 0,
    danger: 0, dangerHold: 0, dangerSet: 0,
    pulses: [], pulseE: 0,
    dim: 0,

    /* signature */
    parts: [], sigFade: 1, sigSwap: false,

    /* orbites / temps */
    t: 0, moonT: 0,

    /* événements */
    ev: {},               // { comet, meteors, eclipse, storm, aurora }
    nextEvent: 7,
    abAdded: 0,           // aberration ajoutée par la tempête (rendue à la fin)

    /* garde-fous */
    frameDeep: -1, frameFront: -1, updFrame: -1,
    version: 1,
    lastMs: 0,
    broken: false
  };

  /* Position courante du corps céleste, recalculée par frame (coût nul). */
  const BODY_POS = { x: 0, y: 0, r: 0 };

  /* ========================================================================
   *  PRÉ-RENDU — NÉBULEUSE
   * ===================================================================== */

  /** Nébuleuse du thème : taches radiales + filaments + poussière, en 1/3 de
   *  résolution, composée en 'lighter'. Elle TEINTE le noir, ne l'éclaircit
   *  jamais : tout ce qui se remarque ici écraserait le jeu. */
  function buildNebula(theme, w, h) {
    const ratio = 0.32;
    const nw = Math.max(8, Math.round(w * ratio));
    const nh = Math.max(8, Math.round(h * ratio));
    const cv = mkCv(nw, nh);
    const g = cv.getContext('2d');
    g.globalCompositeOperation = 'lighter';

    const N = theme.nebula;

    //  BOUCLAGE VERTICAL OBLIGATOIRE. La nébuleuse défile en deux drawImage
    //  empilés ; si son bord haut ne prolonge pas son bord bas, la jonction
    //  dessine une LIGNE HORIZONTALE qui descend lentement en travers de tout
    //  l'écran (mesuré : parfaitement visible sur un aplat doux). On repeint
    //  donc toute forme qui touche un bord à l'autre extrémité du canvas.
    function wrapY(cy, ext, paint) {
      paint(cy);
      if (cy + ext > nh) paint(cy - nh);
      if (cy - ext < 0) paint(cy + nh);
    }

    for (let i = 0; i < N.blobs; i++) {
      // Les accents (couleurs saturées) ne sortent qu'une fois sur trois et
      // toujours plus faibles : la nébuleuse doit se DEVINER.
      const useAccent = (i % 3 === 2);
      const tint = useAccent ? pick(N.accents) : pick(N.tints);
      const cx = rnd(0, nw), cy = rnd(0, nh);
      const r = rnd(0.20, 0.58) * Math.max(nw, nh);
      const peak = N.peak * (useAccent ? rnd(0.30, 0.55) : rnd(0.75, 1.15));
      const rot = Math.random() * Math.PI;
      const sq = N.squash * rnd(0.75, 1.35);

      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0.00, PALETTE.rgba(tint, peak));
      grad.addColorStop(0.42, PALETTE.rgba(tint, peak * 0.44));
      grad.addColorStop(1.00, PALETTE.rgba(tint, 0));

      wrapY(cy, r * Math.max(1, sq), function (y) {
        g.save();
        g.translate(cx, y);
        g.rotate(rot);
        g.scale(1, sq);
        g.fillStyle = grad;
        g.fillRect(-r, -r, r * 2, r * 2);
        g.restore();
      });
    }

    // Filaments : de longues écharpes. C'est ce qui distingue une nébuleuse
    // d'une simple tache floue, et donc un thème d'un autre.
    //
    //  ILS NE SONT PAS DROITS, ET C'EST TOUT L'ENJEU. Une bande rectiligne
    //  tracée d'un seul fillRect commence et s'arrête NET : deux écharpes qui
    //  se croisent dessinaient un « X » de traits durs en travers de l'écran,
    //  qu'on lit comme un défaut d'affichage et non comme du gaz. On les
    //  compose donc en CHAÎNE DE TACHES le long d'une courbe : les extrémités
    //  s'éteignent d'elles-mêmes, l'épaisseur respire, la trajectoire ondule.
    for (let i = 0; i < (N.filaments || 0); i++) {
      const tint = pick(N.tints.concat(N.accents));
      let x = rnd(-0.15, 1.0) * nw;
      let y = rnd(0, nh);
      const len = rnd(0.45, 1.05) * nw;
      let ang = rnd(-0.6, 0.6) + (Math.random() < 0.5 ? 0 : Math.PI);
      const curve = rnd(-0.35, 0.35);                 // courbure totale, en radians
      const thick = rnd(0.030, 0.075) * nh;
      const steps = 12;
      const step = len / steps;
      const peak = N.peak * rnd(0.40, 0.70);

      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        // Enveloppe en cloche : rien aux deux bouts, maximum au milieu.
        const env = Math.pow(Math.sin(t * Math.PI), 0.85);
        const r = thick * (0.75 + 0.55 * Math.sin(t * 5.1 + i)) * (0.5 + env);
        const a = peak * env;
        if (a > 0.002 && r > 0.5) {
          const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
          grad.addColorStop(0.00, PALETTE.rgba(tint, a));
          grad.addColorStop(0.55, PALETTE.rgba(tint, a * 0.38));
          grad.addColorStop(1.00, PALETTE.rgba(tint, 0));
          const px = x, pa = ang;
          wrapY(y, r * 2.1, function (yy) {
            g.save();
            g.translate(px, yy);
            g.rotate(pa);
            g.scale(2.1, 1);                          // la tache est ÉTIRÉE dans l'axe
            g.fillStyle = grad;
            g.fillRect(-r, -r, r * 2, r * 2);
            g.restore();
          });
        }
        ang += curve / steps;
        x += Math.cos(ang) * step;
        y += Math.sin(ang) * step;
      }
    }

    // Poussière : sous le seuil de perception, mais elle « accroche » l'œil.
    g.globalAlpha = 0.30;
    g.fillStyle = N.accents[0];
    const dust = Math.round(nw * nh / 1500);
    for (let i = 0; i < dust; i++) g.fillRect(Math.random() * nw, Math.random() * nh, 1, 1);
    g.globalAlpha = 1;

    return { cv: cv, alpha: N.alpha, speed: N.speed };
  }

  /** Nébuleuse « dernière vie » : construite une fois par taille, indépendante
   *  du thème. Elle se substitue progressivement à celle du thème — le ciel
   *  entier vire au sang. */
  function buildDangerNebula(w, h) {
    const ratio = 0.28;
    const nw = Math.max(8, Math.round(w * ratio));
    const nh = Math.max(8, Math.round(h * ratio));
    const cv = mkCv(nw, nh);
    const g = cv.getContext('2d');
    g.globalCompositeOperation = 'lighter';
    const tints = ['#5a0410', '#8e0a18', DANGER_COL, '#2a0206'];
    for (let i = 0; i < 7; i++) {
      const tint = tints[i % tints.length];
      const r = rnd(0.26, 0.62) * Math.max(nw, nh);
      const peak = (i === 2) ? 0.030 : rnd(0.045, 0.085);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
      grad.addColorStop(0.00, PALETTE.rgba(tint, peak));
      grad.addColorStop(0.45, PALETTE.rgba(tint, peak * 0.40));
      grad.addColorStop(1.00, PALETTE.rgba(tint, 0));
      const cx = rnd(0, nw), cy = rnd(0, nh);
      const rot = Math.random() * Math.PI, sq = rnd(0.5, 1.2);
      // même exigence de bouclage vertical que la nébuleuse de thème
      for (let k = -1; k <= 1; k++) {
        const y = cy + k * nh;
        if (y + r * sq < 0 || y - r * sq > nh) continue;
        g.save();
        g.translate(cx, y);
        g.rotate(rot);
        g.scale(1, sq);
        g.fillStyle = grad;
        g.fillRect(-r, -r, r * 2, r * 2);
        g.restore();
      }
    }
    return { cv: cv, alpha: 0.95, speed: 16 };
  }

  /* ========================================================================
   *  PRÉ-RENDU — LE CORPS CÉLESTE
   * -------------------------------------------------------------------------
   *  VOCABULAIRE, strictement vectoriel :
   *    • le disque n'est PAS rempli : sur fond noir, une planète est un TROU
   *      (les étoiles sont d'ailleurs découpées derrière elle, cf. drawFront) ;
   *    • le terminateur — la frontière jour/nuit — porte l'ARC LUMINEUX ;
   *    • le limbe éclairé s'allume en dégradé vers la source ;
   *    • latitudes et méridiens sont un fil de fer TRÈS faible, deux fois plus
   *      clair du côté jour (obtenu par un clip sur le croissant) ;
   *    • les anneaux passent DERRIÈRE le disque (destination-out) puis devant.
   * ===================================================================== */

  function ringExtent(b) {
    let m = 1.25;
    if (b.rings) for (let i = 0; i < b.rings.length; i++) m = Math.max(m, b.rings[i].r + 0.12);
    if (b.kind === 'blackhole') m = Math.max(m, 2.2);
    if (b.kind === 'binary') m = Math.max(m, 2.9);
    if (b.kind === 'twin') m = Math.max(m, 2.4);
    if (b.kind === 'crystal') m = Math.max(m, 1.9);
    if (b.kind === 'shattered') m = Math.max(m, 1.8);
    return m;
  }

  /** Limbe éclairé + terminateur. `q` : +0,8 = fin croissant, 0 = moitié,
   *  négatif = gibbeux. */
  function crescent(cx, cy, R, light, q, n) {
    const ca = Math.cos(light), sa = Math.sin(light);
    const limb = [], term = [];
    const N = n || 34;
    for (let i = 0; i <= N; i++) {
      const t = -Math.PI / 2 + Math.PI * (i / N);
      const c = Math.cos(t), s = Math.sin(t);
      limb.push({ x: cx + (c * R) * ca - (s * R) * sa, y: cy + (c * R) * sa + (s * R) * ca });
      const tx = q * R * c;
      term.push({ x: cx + tx * ca - (s * R) * sa, y: cy + tx * sa + (s * R) * ca });
    }
    return { limb: limb, term: term };
  }

  function litPath(cr) {
    const pts = cr.limb.slice();
    for (let i = cr.term.length - 1; i >= 0; i--) pts.push(cr.term[i]);
    return NEON.pointsToPath(pts, true);
  }

  /** Le limbe, dégradé : brillant face à la lumière, éteint aux cornes. */
  function strokeLimb(g, cr, col, w, a) {
    const n = cr.limb.length - 1;
    const chunks = 7;
    for (let k = 0; k < chunks; k++) {
      const i0 = Math.floor(k * n / chunks);
      const i1 = Math.floor((k + 1) * n / chunks);
      const seg = cr.limb.slice(i0, i1 + 1);
      const tc = -Math.PI / 2 + Math.PI * ((i0 + i1) / 2 / n);
      const grad = 0.18 + 0.82 * Math.pow(Math.cos(tc), 1.4);
      NEON.polyline(g, seg, col, w * (0.6 + 0.6 * grad), { alpha: a * grad, passes: 4, cap: 'round' });
    }
  }

  /** Fil de fer : latitudes + méridiens. Volontairement à la limite du visible. */
  function wireframe(g, cx, cy, R, col, b, a) {
    const tilt = b.tilt == null ? 0.3 : b.tilt;
    const lat = b.lat || 0;
    for (let i = 1; i <= lat; i++) {
      const phi = -Math.PI / 2 + Math.PI * (i / (lat + 1));
      const rx = R * Math.cos(phi);
      const ry = Math.max(0.6, rx * tilt);
      const y = cy + R * Math.sin(phi) * (1 - tilt * 0.35);
      const w = (i === Math.ceil((lat + 1) / 2)) ? 1.15 : 0.75;
      NEON.polyline(g, ellipsePts(cx, y, rx, ry, 0, 0, TAU, 40), col, w,
                    { alpha: a * (i === Math.ceil((lat + 1) / 2) ? 1.25 : 1), passes: 2, halo: false });
    }
    const mer = b.mer || 0;
    for (let i = 0; i < mer; i++) {
      // Le décalage de 0,35 rad n'est pas cosmétique : sans lui, mer = 1 tombe
      // pile sur ψ = π/2, cos(ψ) = 0, et le « méridien » dégénère en un TRAIT
      // VERTICAL d'un pixel au milieu de la planète — on lit un défaut, pas un
      // globe. Le plancher à 0,18 R protège les autres cas.
      const psi = (i + 0.5) * Math.PI / Math.max(1, mer) + 0.35;
      const rx = Math.max(R * 0.18, R * Math.abs(Math.cos(psi)));
      NEON.polyline(g, ellipsePts(cx, cy, rx, R, 0, 0, TAU, 44), col, 0.7,
                    { alpha: a * 0.8, passes: 2, halo: false });
    }
  }

  function punchDisc(g, cx, cy, r) {
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.fill();
    g.restore();
  }

  function drawRings(g, cx, cy, R, col, b, front) {
    if (!b.rings) return;
    const tilt = b.ringTilt == null ? 0.30 : b.ringTilt;
    const rot = b.ringRot || 0;
    for (let i = 0; i < b.rings.length; i++) {
      const r = b.rings[i];
      const rx = R * r.r;
      const ry = rx * (r.ry != null ? r.ry : tilt);
      const a0 = front ? 0 : Math.PI;
      const pts = ellipsePts(cx, cy, rx, ry, rot, a0, a0 + Math.PI, 48);
      NEON.polyline(g, pts, col, r.w || 1.4,
                    { alpha: (r.a == null ? 0.5 : r.a) * (front ? 1 : 0.40), passes: 4, cap: 'butt' });
    }
  }

  /* --- planète « classique » : ringed / gas / ice / volcanic / ocean ------ */
  function drawSphereWorld(g, cx, cy, R, b) {
    const col = tri(b.glow, b.core);
    const col2 = tri(b.glow2 || b.glow, b.core);
    const cr = crescent(cx, cy, R, b.light, b.phase);

    drawRings(g, cx, cy, R, col2, b, false);
    if (b.rings) punchDisc(g, cx, cy, R * 0.995);

    // Limbe COMPLET, sourd mais lisible : c'est lui qui dit « sphère ». Trop
    // faible (il l'était), on ne lisait plus qu'un croissant, et la planète
    // ressemblait à une goutte d'eau posée sur le ciel.
    NEON.circle(g, cx, cy, R, col, 1.1, { alpha: 0.30, passes: 3, glowScale: 1.3 });

    // fil de fer : partout faible, puis renforcé côté jour
    wireframe(g, cx, cy, R, col, b, 0.075);
    g.save();
    g.clip(litPath(cr));
    wireframe(g, cx, cy, R, col2, b, 0.16);
    if (b.kind === 'gas') {
      // Géante gazeuse : les bandes DEVIENNENT le sujet.
      for (let i = 0; i < 7; i++) {
        const phi = -1.15 + 2.3 * (i / 6);
        const rx = R * Math.cos(phi), ry = Math.max(0.8, rx * (b.tilt || 0.3));
        const y = cy + R * Math.sin(phi) * (1 - (b.tilt || 0.3) * 0.35);
        NEON.polyline(g, ellipsePts(cx, y, rx, ry, 0, 0, TAU, 36),
                      i % 2 ? col2 : col, 1.1 + (i % 3), { alpha: 0.13, passes: 2, halo: false });
      }
      if (b.storm) {
        NEON.polyline(g, ellipsePts(cx + R * b.storm.x, cy + R * b.storm.y,
                                    R * b.storm.rx, R * b.storm.ry, 0.2, 0, TAU, 28),
                      col2, 1.6, { alpha: 0.42, passes: 3 });
      }
    }
    if (b.kind === 'volcanic') {
      // Fractures incandescentes. On les MÉMORISE pour les repasser hors du
      // croissant : sur une phase fine, tout le réseau tombait dans l'ombre et
      // le « monde-forge » n'était plus qu'un cercle rouge vide.
      //  Des FISSURES, pas un gribouillage. Des segments courts (6 % du rayon),
      //  beaucoup de branches, un trait fin : la version à segments longs
      //  dessinait un bonhomme allumettes en travers de la planète.
      b._cracks = [];
      const nCracks = (b.cracks || 6) * 2;
      for (let i = 0; i < nCracks; i++) {
        const a = rnd(0, TAU), rr = Math.sqrt(Math.random()) * 0.78 * R;
        let x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const pts = [{ x: x, y: y }];
        // une fissure suit la courbure du globe : direction dominante + bruit
        let dir = a + Math.PI / 2 + rnd(-0.9, 0.9);
        const steps = irnd(4, 7);
        for (let k = 0; k < steps; k++) {
          dir += rnd(-0.55, 0.55);
          x += Math.cos(dir) * R * rnd(0.045, 0.085);
          y += Math.sin(dir) * R * rnd(0.045, 0.085);
          // rien ne dépasse du globe
          const dx = x - cx, dy = y - cy;
          if (Math.hypot(dx, dy) > R * 0.93) break;
          pts.push({ x: x, y: y });
        }
        if (pts.length < 2) continue;
        b._cracks.push(pts);
        NEON.polyline(g, pts, col2, 1.15, { alpha: 0.68, passes: 3 });
      }
    }
    if (b.kind === 'ocean') {
      // Reflet spéculaire : un éclat court, juste au bord du terminateur.
      const i0 = Math.floor(cr.term.length * 0.34), i1 = Math.floor(cr.term.length * 0.62);
      NEON.polyline(g, cr.term.slice(i0, i1), col2, 3.4, { alpha: 0.75, passes: 4 });
    }
    g.restore();

    if (b.kind === 'volcanic' && b._cracks) {
      // Côté nuit : les fractures ne s'éteignent pas, elles ROUGEOIENT. C'est
      // la seule chose qu'on voit d'un monde de forge quand il nous tourne
      // presque le dos — et c'est ce qui le rend inoubliable.
      g.save();
      g.beginPath();
      g.arc(cx, cy, R * 0.995, 0, TAU);
      g.clip();
      for (let i = 0; i < b._cracks.length; i++) {
        NEON.polyline(g, b._cracks[i], col2, 1.4,
                      { alpha: 0.30, passes: 4, glowScale: 1.9 });
      }
      g.restore();
      b._cracks = null;                     // rien ne survit au pré-rendu
    }

    if (b.kind === 'ice' && b.caps) {
      // Calottes polaires : deux arcs francs, la signature d'un monde de glace.
      NEON.polyline(g, ellipsePts(cx, cy - R * 0.80, R * 0.52, R * 0.16, 0, 0, TAU, 28),
                    col2, 1.5, { alpha: 0.42, passes: 3 });
      NEON.polyline(g, ellipsePts(cx, cy + R * 0.80, R * 0.46, R * 0.14, 0, 0, TAU, 28),
                    col2, 1.3, { alpha: 0.34, passes: 3 });
    }

    // LE geste : l'arc du terminateur, puis le limbe éclairé
    NEON.polyline(g, cr.term, col2, 2.3, { alpha: 0.92, passes: 4 });
    strokeLimb(g, cr, col, 2.0, 0.85);

    // halo atmosphérique : un anneau très large, très faible
    NEON.circle(g, cx, cy, R * 1.035, col, 1.6, { alpha: 0.10, passes: 4, glowScale: 2.4 });

    drawRings(g, cx, cy, R, col2, b, true);
  }

  /* --- trou noir --------------------------------------------------------- */
  function drawBlackHole(g, cx, cy, R, b) {
    const col = tri(b.glow, b.core);
    const hot = tri(b.glow2 || b.glow, b.core);
    const tilt = b.tilt || 0.30;

    // disque d'accrétion : moitié arrière, puis on découpe le trou, puis l'avant
    NEON.polyline(g, ellipsePts(cx, cy, R * 2.05, R * 2.05 * tilt, -0.12, Math.PI, TAU, 48),
                  hot, 2.6, { alpha: 0.45, passes: 4 });
    NEON.polyline(g, ellipsePts(cx, cy, R * 1.55, R * 1.55 * tilt, -0.12, Math.PI, TAU, 44),
                  col, 1.8, { alpha: 0.32, passes: 3 });
    punchDisc(g, cx, cy, R * 0.98);

    // lentille gravitationnelle : deux arcs verticaux au-dessus/au-dessous
    NEON.polyline(g, ellipsePts(cx, cy, R * 1.30, R * 1.85, 0, -2.55, -0.60, 28),
                  col, 1.5, { alpha: 0.34, passes: 3 });
    NEON.polyline(g, ellipsePts(cx, cy, R * 1.30, R * 1.85, 0, 0.60, 2.55, 28),
                  col, 1.5, { alpha: 0.34, passes: 3 });

    // anneau de photons : le seul trait vraiment brillant
    NEON.circle(g, cx, cy, R * 0.72, hot, 1.5, { alpha: 0.95, passes: 4, glowScale: 1.5 });
    NEON.circle(g, cx, cy, R * 0.60, col, 0.9, { alpha: 0.40, passes: 3 });

    // avant du disque
    NEON.polyline(g, ellipsePts(cx, cy, R * 2.05, R * 2.05 * tilt, -0.12, 0, Math.PI, 48),
                  hot, 3.0, { alpha: 0.85, passes: 4 });
    NEON.polyline(g, ellipsePts(cx, cy, R * 1.55, R * 1.55 * tilt, -0.12, 0, Math.PI, 44),
                  col, 2.0, { alpha: 0.60, passes: 4 });
  }

  /* --- étoile double ----------------------------------------------------- */
  function drawBinary(g, cx, cy, R, b) {
    const A = tri(b.glow, b.core);
    const B = tri(b.glow2 || b.glow, b.core);
    const d = R * 1.45;
    const xa = cx - d * 0.62, xb = cx + d * 0.62;
    const ya = cy - R * 0.12, yb = cy + R * 0.18;
    const rb = R * 0.62;

    // pont de plasma : la matière coule de la petite vers la grande
    const bridge = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      bridge.push({ x: xa + (xb - xa) * t, y: ya + (yb - ya) * t + Math.sin(t * Math.PI) * R * 0.55 });
    }
    NEON.polyline(g, bridge, B, 2.0, { alpha: 0.42, passes: 3 });

    // les deux astres : disque incandescent + couronne + protubérances.
    // Une ÉTOILE n'est pas un anneau vide : le seul corps du jeu qui a le droit
    // d'être rempli, c'est celui qui produit la lumière.
    const suns = [{ x: xa, y: ya, r: R, c: A }, { x: xb, y: yb, r: rb, c: B }];
    for (let s = 0; s < suns.length; s++) {
      const u = suns[s];
      const glow = g.createRadialGradient(u.x, u.y, 0, u.x, u.y, u.r * 1.45);
      glow.addColorStop(0.00, PALETTE.rgba(u.c.core, 0.62));
      glow.addColorStop(0.42, PALETTE.rgba(u.c.glow, 0.34));
      glow.addColorStop(0.70, PALETTE.rgba(u.c.glow, 0.10));
      glow.addColorStop(1.00, PALETTE.rgba(u.c.glow, 0));
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = glow;
      g.fillRect(u.x - u.r * 1.5, u.y - u.r * 1.5, u.r * 3, u.r * 3);
      g.restore();
      NEON.circle(g, u.x, u.y, u.r, u.c, 2.2, { alpha: 0.85, passes: 4, glowScale: 1.6 });
      NEON.circle(g, u.x, u.y, u.r * 0.74, u.c, 1.0, { alpha: 0.30, passes: 3 });
      for (let i = 0; i < 9; i++) {
        const a = rnd(0, TAU), len = rnd(0.10, 0.34) * u.r;
        NEON.line(g, u.x + Math.cos(a) * u.r, u.y + Math.sin(a) * u.r,
                  u.x + Math.cos(a) * (u.r + len), u.y + Math.sin(a) * (u.r + len),
                  u.c, 1.6, { alpha: 0.55, passes: 3 });
      }
    }
  }

  /* --- lunes jumelles ---------------------------------------------------- */
  function drawTwin(g, cx, cy, R, b) {
    const A = tri(b.glow, b.core);
    const B = tri(b.glow2 || b.glow, b.core);
    const bodies = [
      { x: cx - R * 0.85, y: cy - R * 0.30, r: R, c: A, q: b.phase },
      { x: cx + R * 0.95, y: cy + R * 0.55, r: R * 0.66, c: B, q: b.phase * 0.6 }
    ];
    for (let i = 0; i < bodies.length; i++) {
      const u = bodies[i];
      const cr = crescent(u.x, u.y, u.r, b.light, u.q);
      NEON.circle(g, u.x, u.y, u.r, u.c, 0.9, { alpha: 0.18, passes: 3 });
      g.save();
      g.clip(litPath(cr));
      wireframe(g, u.x, u.y, u.r, u.c, b, 0.15);
      g.restore();
      wireframe(g, u.x, u.y, u.r, u.c, b, 0.06);
      NEON.polyline(g, cr.term, u.c, 2.1, { alpha: 0.88, passes: 4 });
      strokeLimb(g, cr, u.c, 1.8, 0.78);
      // quelques cratères : de simples ellipses, jamais remplies
      for (let k = 0; k < 4; k++) {
        const a = rnd(-1.2, 1.2), rr = rnd(0.25, 0.72) * u.r;
        NEON.polyline(g, ellipsePts(u.x + Math.cos(a) * rr, u.y + Math.sin(a) * rr,
                                    u.r * rnd(0.08, 0.16), u.r * rnd(0.04, 0.10), a, 0, TAU, 18),
                      u.c, 0.8, { alpha: 0.16, passes: 2, halo: false });
      }
    }
  }

  /* --- monde de cristal -------------------------------------------------- */
  function drawCrystalWorld(g, cx, cy, R, b) {
    const col = tri(b.glow, b.core);
    const col2 = tri(b.glow2 || b.glow, b.core);
    const n = b.facets || 9;
    const outer = [];
    for (let i = 0; i < n; i++) {
      const a = TAU * i / n - Math.PI / 2;
      const rr = R * (0.86 + (i % 2 ? 0.16 : 0));
      outer.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr });
    }
    // facettes internes
    for (let i = 0; i < n; i++) {
      const p = outer[i], q = outer[(i + 3) % n];
      NEON.line(g, p.x, p.y, q.x, q.y, col, 0.8, { alpha: 0.13, passes: 2, halo: false });
      NEON.line(g, p.x, p.y, cx, cy, col, 0.7, { alpha: 0.09, passes: 2, halo: false });
    }
    NEON.shape(g, outer, col, 1.7, { alpha: 0.55, passes: 4 });
    // arête éclairée : la moitié tournée vers la lumière
    const ca = Math.cos(b.light), sa = Math.sin(b.light);
    for (let i = 0; i < n; i++) {
      const p = outer[i], q = outer[(i + 1) % n];
      const mx = (p.x + q.x) / 2 - cx, my = (p.y + q.y) / 2 - cy;
      const d = (mx * ca + my * sa) / R;
      if (d > 0) NEON.line(g, p.x, p.y, q.x, q.y, col2, 2.6, { alpha: 0.35 + 0.55 * d, passes: 4 });
    }
    // ceinture d'éclats
    const belt = b.belt || 12;
    for (let i = 0; i < belt; i++) {
      const a = TAU * i / belt + rnd(-0.09, 0.09);
      const rr = R * rnd(1.30, 1.62);
      const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * (b.tilt || 0.3);
      const s = R * rnd(0.035, 0.075);
      NEON.shape(g, [{ x: x, y: y - s }, { x: x + s * 0.6, y: y }, { x: x, y: y + s }, { x: x - s * 0.6, y: y }],
                 col2, 1.0, { alpha: rnd(0.30, 0.70), passes: 3 });
    }
  }

  /* --- planète brisée ---------------------------------------------------- */
  function drawShattered(g, cx, cy, R, b) {
    const col = tri(b.glow, b.core);
    const col2 = tri(b.glow2 || b.glow, b.core);
    const cr = crescent(cx, cy, R, b.light, b.phase);

    // le limbe est fracturé : des arcs séparés, décalés vers l'extérieur
    let a = 0;
    while (a < TAU) {
      const span = rnd(0.28, 0.85);
      const off = rnd(0.98, 1.10);
      NEON.polyline(g, ellipsePts(cx, cy, R * off, R * off, 0, a, a + span, 16),
                    col, 1.5, { alpha: rnd(0.28, 0.65), passes: 3 });
      a += span + rnd(0.10, 0.32);
    }
    g.save();
    g.clip(litPath(cr));
    wireframe(g, cx, cy, R, col2, b, 0.15);
    g.restore();
    NEON.polyline(g, cr.term, col2, 2.2, { alpha: 0.80, passes: 4 });

    // noyau exposé
    NEON.circle(g, cx, cy, R * 0.28, col2, 2.0, { alpha: 0.85, passes: 4, glowScale: 1.8 });

    // ceinture de débris
    const n = b.shards || 20;
    for (let i = 0; i < n; i++) {
      const ang = TAU * i / n + rnd(-0.12, 0.12);
      const rr = R * rnd(1.18, 1.60);
      const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr * (b.tilt || 0.3);
      const s = R * rnd(0.02, 0.06);
      NEON.line(g, x - s, y - s * 0.4, x + s, y + s * 0.4,
                (i % 3 === 0) ? col2 : col, 1.2, { alpha: rnd(0.25, 0.70), passes: 3 });
    }
  }

  /** Construit (ou reconstruit) le corps céleste. Coûteux : appelé UNIQUEMENT
   *  au changement de thème ou d'échelle. */
  function buildBody(theme, w, h) {
    const b = theme.body;
    const R = Math.max(26, Math.min(w, h) * b.scale);
    const pad = Math.ceil(R * ringExtent(b) + 30);
    const cv = mkCv(pad * 2, pad * 2);
    const g = cv.getContext('2d');
    const cx = pad, cy = pad;

    switch (b.kind) {
      case 'blackhole': drawBlackHole(g, cx, cy, R, b); break;
      case 'binary':    drawBinary(g, cx, cy, R, b); break;
      case 'twin':      drawTwin(g, cx, cy, R, b); break;
      case 'crystal':   drawCrystalWorld(g, cx, cy, R, b); break;
      case 'shattered': drawShattered(g, cx, cy, R, b); break;
      default:          drawSphereWorld(g, cx, cy, R, b); break;
    }

    return { cv: cv, pad: pad, R: R, occlude: (b.occlude == null ? 0.99 : b.occlude), def: b };
  }

  /* ========================================================================
   *  PRÉ-RENDU — SPRITES (signature, bandes, voiles)
   * ===================================================================== */

  function sprite(key, w, h, painter) {
    let s = S.sprites[key];
    if (s) return s;
    s = mkCv(w, h);
    try { painter(s.getContext('2d'), s.width, s.height); }
    catch (e) { /* un sprite raté ne doit jamais casser une frame */ }
    S.sprites[key] = s;
    return s;
  }

  /** Un grain de signature. `kind` fixe la GRAMMAIRE de la particule. */
  function sigSprite(kind, colHex, size) {
    const R = Math.max(2, size);
    const pad = Math.ceil(R * 2.8) + 2;
    return sprite('sig|' + kind + '|' + colHex + '|' + Math.round(R * 10), pad * 2, pad * 2,
      function (g) {
        const c = pad, col = tri(colHex);
        switch (kind) {
          case 'crystals':
            NEON.shape(g, [{ x: c, y: c - R }, { x: c + R * 0.58, y: c },
                           { x: c, y: c + R }, { x: c - R * 0.58, y: c }],
                       col, Math.max(1, R * 0.15), { alpha: 1, passes: 4 });
            break;
          case 'shards':
            NEON.polyline(g, [{ x: c - R, y: c + R * 0.45 }, { x: c + R * 0.35, y: c - R * 0.35 },
                              { x: c + R, y: c + R * 0.15 }],
                          col, Math.max(1, R * 0.16), { alpha: 1, passes: 3 });
            break;
          case 'motes':
            NEON.circle(g, c, c, R * 0.66, col, Math.max(1, R * 0.20), { alpha: 1, passes: 4 });
            NEON.dot(g, c, c, R * 0.16, col, { alpha: 0.9 });
            break;
          case 'sparks':
            NEON.line(g, c - R, c + R * 0.5, c + R, c - R * 0.5, col,
                      Math.max(1, R * 0.20), { alpha: 1, passes: 3 });
            break;
          case 'embers':
            NEON.dot(g, c, c, R * 0.42, col, { alpha: 1, glowScale: 1.35 });
            break;
          default: /* snow, dust, infall */
            NEON.dot(g, c, c, R * 0.38, col, { alpha: 1, glowScale: 1.1 });
            break;
        }
      });
  }

  /** Bande douce, réutilisée pour la brume et pour la tempête magnétique. */
  function bandSprite(colHex) {
    return sprite('band|' + colHex, 8, 128, function (g, w, h) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.00, PALETTE.rgba(colHex, 0));
      grad.addColorStop(0.42, PALETTE.rgba(colHex, 0.85));
      grad.addColorStop(0.58, PALETTE.rgba(colHex, 0.85));
      grad.addColorStop(1.00, PALETTE.rgba(colHex, 0));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
  }

  /** Voile d'aurore : un ruban vertical strié, dégradé vers le bas.
   *
   *  LE SPRITE EST LARGE (512 px) EXPRÈS. Un voile occupe ~500 px à l'écran ;
   *  avec un sprite de 96 px, chaque striation d'un pixel était étirée en une
   *  BARRE de 5 à 15 px aux bords nets — le rideau ressemblait à une mire de
   *  test. À 512 px, les striations restent des cheveux, et les bords latéraux
   *  s'éteignent pour que deux voiles voisins se fondent au lieu de se
   *  découper. */
  function veilSprite(colHex) {
    return sprite('veil|' + colHex, 512, 256, function (g, w, h) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0.00, PALETTE.rgba(colHex, 0.00));
      grad.addColorStop(0.14, PALETTE.rgba(colHex, 0.80));
      grad.addColorStop(0.50, PALETTE.rgba(colHex, 0.30));
      grad.addColorStop(1.00, PALETTE.rgba(colHex, 0.00));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);

      // striations verticales : c'est ce qui fait « rideau » et non « dégradé »
      g.globalCompositeOperation = 'lighter';
      const bright = PALETTE.lighten(colHex, 0.5);
      for (let i = 0; i < 60; i++) {
        const x = Math.random() * w;
        const bw = 1 + Math.random() * Math.random() * 4;
        const bh = h * (0.35 + Math.random() * 0.65);
        const a = 0.03 + Math.random() * Math.random() * 0.14;
        const sg = g.createLinearGradient(0, 0, 0, bh);
        sg.addColorStop(0.00, PALETTE.rgba(bright, 0));
        sg.addColorStop(0.22, PALETTE.rgba(bright, a));
        sg.addColorStop(1.00, PALETTE.rgba(bright, 0));
        g.fillStyle = sg;
        g.fillRect(x, 0, bw, bh);
      }

      // extinction des deux bords : un voile n'a pas d'arête verticale.
      g.globalCompositeOperation = 'destination-out';
      const edge = g.createLinearGradient(0, 0, w, 0);
      edge.addColorStop(0.00, 'rgba(0,0,0,1)');
      edge.addColorStop(0.13, 'rgba(0,0,0,0)');
      edge.addColorStop(0.87, 'rgba(0,0,0,0)');
      edge.addColorStop(1.00, 'rgba(0,0,0,1)');
      g.fillStyle = edge;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    });
  }

  /** Onde de couleur (BACKDROP.pulse) : un disque à chute douce, PRÉ-RENDU une
   *  fois par couleur. Trois arc()+fill() empilés donnaient des cercles aux
   *  bords francs — on voyait la géométrie au lieu de la lumière. */
  function pulseSprite(colHex) {
    return sprite('pulse|' + colHex, 256, 256, function (g, w, h) {
      const c = w / 2;
      const grad = g.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0.00, PALETTE.rgba(colHex, 0.85));
      grad.addColorStop(0.28, PALETTE.rgba(colHex, 0.34));
      grad.addColorStop(0.58, PALETTE.rgba(colHex, 0.10));
      grad.addColorStop(1.00, PALETTE.rgba(colHex, 0.00));
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
  }

  /* ========================================================================
   *  SIGNATURE : les particules en suspension
   * ===================================================================== */

  function spawnParticle(p, sig, w, h, first) {
    const k = sig.kind;
    p.rot = rnd(0, TAU);
    p.rs = rnd(-0.9, 0.9);
    p.sc = rnd(0.55, 1.35);
    p.ph = rnd(0, TAU);
    p.a = sig.alpha * rnd(0.45, 1.0);

    if (k === 'infall') {
      // aspirées vers le corps : elles naissent LOIN, sur un cercle large
      const ang = rnd(0, TAU);
      const rr = Math.max(w, h) * rnd(0.45, 0.75);
      p.x = BODY_POS.x + Math.cos(ang) * rr;
      p.y = BODY_POS.y + Math.sin(ang) * rr * 0.72;
      p.vx = 0; p.vy = 0;
      return;
    }

    p.x = rnd(-0.05, 1.05) * w;
    p.y = first ? rnd(-0.05, 1.05) * h : (sig.rise ? h + rnd(0, 40) : -rnd(0, 40));

    const sp = sig.speed;
    switch (k) {
      case 'embers': p.vx = rnd(-14, 14); p.vy = -sp * rnd(0.55, 1.25); break;
      case 'dust':   p.vx = -sp * 0.22;   p.vy = sp * rnd(0.65, 1.35); break;
      case 'sparks': p.vx = rnd(-1, 1) * sp * 0.5; p.vy = sp * rnd(0.75, 1.4); break;
      case 'shards': p.vx = rnd(-1, 1) * sp * 0.35; p.vy = sp * rnd(0.7, 1.3); break;
      case 'motes':  p.vx = rnd(-6, 6);   p.vy = sp * rnd(0.4, 1.1); break;
      default:       p.vx = rnd(-9, 9);   p.vy = sp * rnd(0.55, 1.3); break;
    }
  }

  function buildParticles(theme, w, h) {
    const sig = theme.sig;
    S.parts.length = 0;
    if (!sig || sig.kind === 'mist') return;
    // densité rapportée à la surface : un écran 4K n'a pas 4x plus de grains,
    // sinon la signature devient une soupe.
    const scale = cl(Math.sqrt((w * h) / (1440 * 900)), 0.7, 1.6);
    const n = Math.round(cl(sig.count * scale, 8, 90));
    for (let i = 0; i < n; i++) {
      const p = {};
      spawnParticle(p, sig, w, h, true);
      S.parts.push(p);
    }
  }

  function updateParticles(dt, w, h) {
    const sig = S.theme.sig;
    if (!sig || sig.kind === 'mist' || !S.parts.length) return;
    const boost = 1 + S.intensity * 0.85;
    const k = sig.kind;

    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];

      if (k === 'infall') {
        // chute libre vers le corps : accélération en 1/r, respawn au centre
        const dx = BODY_POS.x - p.x, dy = (BODY_POS.y - p.y) * 1.35;
        const d = Math.max(24, Math.hypot(dx, dy));
        const acc = sig.speed * 26 / d;
        p.vx += (dx / d) * acc * dt;
        p.vy += (dy / d) * acc * dt;
        p.x += p.vx * boost * dt;
        p.y += p.vy * boost * dt;
        if (d < Math.max(30, BODY_POS.r * 0.7)) spawnParticle(p, sig, w, h, false);
        continue;
      }

      p.x += (p.vx + Math.sin(S.t * 0.6 + p.ph) * (k === 'snow' ? 16 : 5)) * boost * dt;
      p.y += p.vy * boost * dt;
      p.rot += p.rs * dt;

      if (p.y < -60) { spawnParticle(p, sig, w, h, false); p.y = h + rnd(0, 40); }
      else if (p.y > h + 60) { spawnParticle(p, sig, w, h, false); p.y = -rnd(0, 40); }
      if (p.x < -60) p.x = w + 40;
      else if (p.x > w + 60) p.x = -40;
    }
  }

  function drawParticles(c) {
    const sig = S.theme.sig;
    if (!sig || sig.kind === 'mist' || !S.parts.length) return;
    const fade = S.sigFade * (1 - S.dim * 0.55);
    if (fade <= 0.02) return;

    const spr = sigSprite(sig.kind, sig.col, sig.size);
    const half = spr.width / 2;
    const rotates = (sig.kind === 'crystals' || sig.kind === 'shards');
    const pulses = (sig.kind === 'motes' || sig.kind === 'embers');

    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < S.parts.length; i++) {
      const p = S.parts[i];
      let a = p.a * fade;
      let sc = p.sc;
      if (pulses) {
        const f = 0.55 + 0.45 * Math.sin(S.t * 2.4 + p.ph);
        a *= f; sc *= 0.8 + 0.3 * f;
      }
      if (a <= 0.01) continue;
      c.globalAlpha = a;
      const s = half * 2 * sc;
      if (rotates) {
        c.save();
        c.translate(p.x, p.y);
        c.rotate(p.rot);
        c.drawImage(spr, -s / 2, -s / 2, s, s);
        c.restore();
      } else {
        c.drawImage(spr, p.x - s / 2, p.y - s / 2, s, s);
      }
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /** Brume : de larges bandes horizontales qui ondulent. Trois blits partiels,
   *  pas une particule. */
  function drawMist(c, w, h) {
    const sig = S.theme.sig;
    if (!sig || sig.kind !== 'mist') return;
    const spr = bandSprite(sig.col);
    const n = sig.count || 4;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const ph = i * 1.7;
      const y = ((i + 0.5) / n) * h + Math.sin(S.t * 0.16 + ph) * h * 0.06;
      const th = h * (0.10 + 0.05 * Math.sin(S.t * 0.11 + ph * 2));
      const x = Math.sin(S.t * 0.09 + ph) * w * 0.05;
      c.globalAlpha = sig.alpha * S.sigFade * (0.6 + 0.4 * Math.sin(S.t * 0.23 + ph)) * (1 - S.dim * 0.5);
      c.drawImage(spr, x - w * 0.06, y - th / 2, w * 1.12, th);
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /* ========================================================================
   *  LES CINQ ÉVÉNEMENTS
   * ===================================================================== */

  const EV_KINDS = ['comet', 'meteors', 'eclipse', 'storm', 'aurora'];

  function startEvent(kind) {
    const w = S.w, h = S.h;
    switch (kind) {
      case 'comet': {
        const dir = Math.random() < 0.5 ? 1 : -1;
        const dur = rnd(2.6, 4.2);
        S.ev.comet = {
          t: 0, dur: dur + 0.6,
          x: dir > 0 ? -w * 0.15 : w * 1.15,
          y: rnd(-0.05, 0.45) * h,
          vx: dir * (w * 1.3) / dur,
          vy: (rnd(0.30, 0.62) * h) / dur,
          col: pick(S.theme.nebula.accents),
          size: rnd(2.4, 4.2)
        };
        break;
      }
      case 'meteors': {
        const right = Math.random() < 0.5;
        const ang = (right ? 1 : -1) * rnd(0.42, 0.72);
        // La rafale est ÉTALÉE sur toute sa durée : la première version vidait
        // son stock en deux secondes, on ratait la pluie en clignant des yeux.
        const dur = rnd(4.5, 7.0);
        const left = irnd(26, 44);
        S.ev.meteors = {
          t: 0, dur: dur, left: left,
          rate: dur / left,               // intervalle moyen entre deux traits
          spawn: 0, ang: ang, items: [],
          col: pick(S.theme.nebula.accents)
        };
        break;
      }
      case 'eclipse': {
        const dur = rnd(6.5, 9.5);
        S.ev.eclipse = { t: 0, dur: dur, dir: Math.random() < 0.5 ? 1 : -1 };
        break;
      }
      case 'storm': {
        S.ev.storm = { t: 0, dur: rnd(5.0, 9.0), seed: rnd(0, 100) };
        break;
      }
      case 'aurora': {
        const cols = (S.theme.aurora && S.theme.aurora.cols) ||
                     S.theme.nebula.accents.concat([S.theme.nebula.tints[1]]);
        const n = irnd(3, 4);
        const rib = [];
        for (let i = 0; i < n; i++) {
          rib.push({
            x: rnd(-0.1, 0.75), w: rnd(0.28, 0.55), h: rnd(0.38, 0.68),
            col: cols[i % cols.length], amp: rnd(0.02, 0.055),
            sp: rnd(0.35, 0.85) * (Math.random() < 0.5 ? 1 : -1),
            ph: rnd(0, TAU), a: rnd(0.55, 1.0), drift: rnd(-0.012, 0.012)
          });
        }
        S.ev.aurora = { t: 0, dur: rnd(9, 16), rib: rib };
        break;
      }
    }
    try {
      if (typeof gameEvent === 'function') gameEvent('backdropEvent', { kind: kind });
    } catch (e) { /* un événement de fond ne fait jamais de bruit obligatoire */ }
  }

  function pickEvent() {
    const wgt = S.theme.evt || {};
    let total = 0;
    const avail = [];
    for (let i = 0; i < EV_KINDS.length; i++) {
      const k = EV_KINDS[i];
      if (S.ev[k]) continue;                                   // déjà en cours
      if (k === 'aurora' && S.theme.aurora) continue;           // déjà permanente
      const v = Math.max(0.05, wgt[k] == null ? 1 : wgt[k]);
      avail.push({ k: k, v: v });
      total += v;
    }
    if (!avail.length) return null;
    let r = Math.random() * total;
    for (let i = 0; i < avail.length; i++) {
      r -= avail[i].v;
      if (r <= 0) return avail[i].k;
    }
    return avail[avail.length - 1].k;
  }

  /** Enveloppe d'un événement : montée douce, plateau, descente douce. */
  function envelope(e, up, down) {
    const inn = smooth(e.t / (up || 0.8));
    const out = smooth((e.dur - e.t) / (down || 1.2));
    return Math.min(inn, out);
  }

  function updateEvents(dt) {
    const w = S.w, h = S.h;
    const ev = S.ev;

    /* --- comète --- */
    if (ev.comet) {
      const e = ev.comet;
      e.t += dt;
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.t >= e.dur || e.y > h * 1.3) ev.comet = null;
    }

    /* --- pluie de météores --- */
    if (ev.meteors) {
      const e = ev.meteors;
      e.t += dt;
      e.spawn -= dt;
      if (e.left > 0 && e.spawn <= 0) {
        // Rafales irrégulières : parfois deux traits coup sur coup, parfois un
        // silence. Une cadence régulière se lit comme une animation en boucle.
        e.spawn = (e.rate || 0.14) * rnd(0.25, 1.9);
        e.left--;
        const sp = rnd(900, 1700);
        e.items.push({
          x: rnd(-0.25, 1.25) * w, y: rnd(-0.30, 0.10) * h,
          ux: Math.sin(e.ang), uy: Math.cos(e.ang),
          sp: sp, len: sp * rnd(0.085, 0.155), t: 0, ttl: rnd(0.7, 1.3),
          big: Math.random() < 0.22
        });
      }
      for (let i = e.items.length - 1; i >= 0; i--) {
        const m = e.items[i];
        m.t += dt;
        m.x += m.ux * m.sp * dt;
        m.y += m.uy * m.sp * dt;
        if (m.t >= m.ttl || m.y > h * 1.25) e.items.splice(i, 1);
      }
      if (e.t >= e.dur && !e.items.length) ev.meteors = null;
    }

    /* --- éclipse --- */
    if (ev.eclipse) {
      const e = ev.eclipse;
      e.t += dt;
      if (e.t >= e.dur) ev.eclipse = null;
    }

    /* --- tempête magnétique --- */
    if (ev.storm) {
      const e = ev.storm;
      e.t += dt;
      if (e.t >= e.dur) { ev.storm = null; setAberration(0); }
      else setAberration(envelope(e, 1.2, 1.6) * 2.6);
    }

    /* --- aurore --- */
    if (ev.aurora) {
      const e = ev.aurora;
      e.t += dt;
      for (let i = 0; i < e.rib.length; i++) {
        const r = e.rib[i];
        r.x += r.drift * dt;
        if (r.x < -0.35) r.x = 0.95;
        else if (r.x > 1.0) r.x = -0.3;
      }
      if (e.t >= e.dur) ev.aurora = null;
    }

    /* --- ordonnancement : de loin en loin, jamais deux fois de suite pareil - */
    S.nextEvent -= dt * (1 + S.intensity * 0.45);
    if (S.nextEvent <= 0) {
      const k = pickEvent();
      if (k) startEvent(k);
      S.nextEvent = rnd(11, 26);
    }
  }

  /** Renforce l'aberration chromatique pendant la tempête. On MÉMORISE ce
   *  qu'on a ajouté et on ne rend QUE ça : si un autre module change le
   *  réglage entre-temps, sa valeur est préservée. */
  function setAberration(px) {
    try {
      if (typeof RENDER_CONFIG === 'undefined' || !RENDER_CONFIG) return;
      const want = cl(px || 0, 0, 4);
      const delta = want - S.abAdded;
      if (Math.abs(delta) < 0.01) return;
      RENDER_CONFIG.aberration = Math.max(0, (RENDER_CONFIG.aberration || 0) + delta);
      S.abAdded = want;
    } catch (e) { /* jamais bloquant */ }
  }

  /* ---------------------------------------------------- dessin des événements */

  function drawComet(c) {
    const e = S.ev.comet;
    if (!e) return;
    const col = tri(e.col);
    const fade = smooth(e.t / 0.35) * smooth((e.dur - e.t) / 0.6);
    if (fade <= 0.01) return;

    // Traînée analytique : le mouvement est rectiligne, aucune histoire à
    // stocker. Huit segments dégressifs valent un dégradé, pour rien — et
    // deux tiers de seconde de traînée, c'est la moitié de l'écran.
    const tail = 0.66;
    const segs = 8;
    for (let k = segs; k >= 1; k--) {
      const t0 = (k / segs) * tail, t1 = ((k - 1) / segs) * tail;
      const a = fade * 0.42 * Math.pow(1 - (k - 1) / segs, 2.1);
      NEON.line(c, e.x - e.vx * t0, e.y - e.vy * t0, e.x - e.vx * t1, e.y - e.vy * t1,
                col, e.size * (1.1 - k / (segs + 2)) * 1.6, { alpha: a, passes: 2, cap: 'round' });
    }
    NEON.dot(c, e.x, e.y, e.size, col, { alpha: fade, glowScale: 1.9 });
    // deux éclats en croix : la comète doit se lire même petite
    const f = e.size * 7;
    NEON.line(c, e.x - f, e.y, e.x + f, e.y, col, 1.1, { alpha: fade * 0.30, passes: 2 });
    NEON.line(c, e.x, e.y - f * 0.6, e.x, e.y + f * 0.6, col, 1.1, { alpha: fade * 0.24, passes: 2 });
  }

  function drawMeteors(c) {
    const e = S.ev.meteors;
    if (!e) return;
    const col = tri(e.col);
    const white = tri('#ffffff');
    for (let i = 0; i < e.items.length; i++) {
      const m = e.items[i];
      const k = m.t / m.ttl;
      const a = smooth(k / 0.18) * (1 - smooth((k - 0.55) / 0.45));
      if (a <= 0.02) continue;
      const bg = m.big ? 1.9 : 1;
      const x2 = m.x - m.ux * m.len, y2 = m.y - m.uy * m.len;
      // queue longue et sourde…
      NEON.line(c, x2, y2, m.x, m.y, col, 2.1 * bg, { alpha: a * 0.55, passes: 3, cap: 'butt' });
      // …puis le tiers de tête, franc et blanc : c'est lui qu'on voit passer.
      NEON.line(c, m.x - m.ux * m.len * 0.33, m.y - m.uy * m.len * 0.33, m.x, m.y,
                white, 1.4 * bg, { alpha: a * 0.9, passes: 3 });
      if (m.big) NEON.dot(c, m.x, m.y, 2.2, white, { alpha: a, glowScale: 1.8 });
    }
  }

  /** Position et rayon du corps occultant de l'éclipse. */
  function eclipseBody(e) {
    const R = BODY_POS.r;
    const span = R * 2.9;
    const k = e.t / e.dur;
    return {
      x: BODY_POS.x + e.dir * (-span + 2 * span * k),
      y: BODY_POS.y + R * 0.14 * Math.sin(k * Math.PI),
      r: R * 0.94
    };
  }

  /** Couverture 0..1 de l'éclipse (sert aussi à assombrir le ciel). */
  function eclipseCover() {
    const e = S.ev.eclipse;
    if (!e || !S.body) return 0;
    const b = eclipseBody(e);
    const d = Math.abs(b.x - BODY_POS.x);
    return smooth(1 - d / (BODY_POS.r * 1.9));
  }

  function drawEclipse(c) {
    const e = S.ev.eclipse;
    if (!e || !S.body) return;
    const b = eclipseBody(e);
    const cover = eclipseCover();
    const col = tri(S.theme.nebula.accents[0]);
    const hot = tri(S.theme.body.core || '#ffffff');

    // 1) le corps occultant est OPAQUE : il efface tout ce qu'il recouvre
    beginPunch(c);
    c.beginPath();
    c.arc(b.x, b.y, b.r, 0, TAU);
    c.fill();
    endPunch(c);

    // 2) son liseré s'embrase — d'autant plus que la couverture est totale
    const rim = 0.35 + 0.65 * cover;
    NEON.circle(c, b.x, b.y, b.r, col, 1.6 + 2.2 * cover,
                { alpha: rim, passes: 4, glowScale: 1.4 + cover });
    if (cover > 0.35) {
      NEON.circle(c, b.x, b.y, b.r * 1.02, hot, 1.0,
                  { alpha: (cover - 0.35) * 1.1, passes: 3, glowScale: 2.2 });
      // couronne : de courts rayons, seulement près de la totalité
      const rays = 16;
      for (let i = 0; i < rays; i++) {
        const a = TAU * i / rays + S.t * 0.05;
        const l = b.r * (0.06 + 0.22 * cover * (0.6 + 0.4 * Math.sin(i * 2.3 + S.t)));
        NEON.line(c, b.x + Math.cos(a) * b.r, b.y + Math.sin(a) * b.r,
                  b.x + Math.cos(a) * (b.r + l), b.y + Math.sin(a) * (b.r + l),
                  col, 1.4, { alpha: (cover - 0.3) * 0.6, passes: 2 });
      }
    }
    // 3) le limbe de la planète, lui aussi, s'embrase
    if (cover > 0.15) {
      NEON.circle(c, BODY_POS.x, BODY_POS.y, BODY_POS.r * 1.01, col, 1.8,
                  { alpha: (cover - 0.15) * 0.75, passes: 4, glowScale: 1.8 });
    }
  }

  function drawStorm(c, w, h) {
    const e = S.ev.storm;
    if (!e) return;
    const env = envelope(e, 1.2, 1.6);
    if (env <= 0.02) return;
    const cols = S.theme.nebula.accents;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const ph = e.seed + i * 1.31;
      const y = ((i + 0.5) / 6) * h + Math.sin(S.t * 1.15 + ph) * h * 0.09;
      const th = h * (0.05 + 0.035 * Math.sin(S.t * 0.9 + ph * 1.7));
      const x = Math.sin(S.t * 0.75 + ph * 0.6) * w * 0.09;
      c.globalAlpha = env * 0.14 * (0.5 + 0.5 * Math.sin(S.t * 1.7 + ph));
      c.drawImage(bandSprite(cols[i % cols.length]), x - w * 0.08, y - th / 2, w * 1.16, th);
    }
    c.globalAlpha = 1;
    c.restore();
  }

  function drawAurora(c, w, h) {
    const perm = S.theme.aurora;
    const e = S.ev.aurora;
    if (!perm && !e) return;

    let rib, env;
    if (e) { rib = e.rib; env = envelope(e, 2.2, 2.6); }
    else {
      if (!S.permRib) {
        const cols = perm.cols;
        S.permRib = [];
        for (let i = 0; i < (perm.ribbons || 3); i++) {
          S.permRib.push({
            x: 0.05 + i * 0.30, w: rnd(0.30, 0.50), h: rnd(0.42, 0.62),
            col: cols[i % cols.length], amp: rnd(0.02, 0.05),
            sp: rnd(0.3, 0.7) * (i % 2 ? -1 : 1), ph: rnd(0, TAU),
            a: rnd(0.6, 1.0), drift: 0
          });
        }
      }
      rib = S.permRib;
      env = perm.alpha;
    }
    if (env <= 0.02) return;

    const dim = 1 - S.dim * 0.6;
    const top = -h * 0.05;

    //  PAS DE DÉCOUPAGE EN TRANCHES. La version en 14 lamelles indépendantes
    //  (chacune avec sa hauteur et son alpha) donnait exactement ce qu'on ne
    //  veut pas : un histogramme de barres verticales aux arêtes franches.
    //  Un rideau, c'est une SEULE image CISAILLÉE — x' = x + k·y — dont
    //  l'inclinaison respire. Deux copies déphasées suffisent à faire onduler
    //  la matière, pour deux drawImage par ruban au lieu de quatorze.
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let r = 0; r < rib.length; r++) {
      const R = rib[r];
      const spr = veilSprite(R.col);
      const rw = R.w * w;
      const rh = R.h * h;
      const x0 = R.x * w;

      // Deuxième passe (la plus douce) réservée à la qualité pleine : c'est
      // elle qui fait onduler la matière, mais elle double le nombre de blits
      // cisaillés, les plus chers du module.
      const passes = (RENDER_CONFIG.quality >= 3) ? 2 : 1;
      for (let pass = 0; pass < passes; pass++) {
        const ph = R.ph + pass * 1.97;
        const sp = R.sp * (pass ? 0.71 : 1);
        // cisaillement : l'écart horizontal croît avec la hauteur du voile
        const k = (Math.sin(S.t * sp + ph) * 0.30 +
                   Math.sin(S.t * sp * 1.63 + ph * 1.4) * 0.14) * (R.amp * 26);
        const hh = rh * (0.80 + 0.20 * Math.sin(S.t * sp * 1.27 + ph));
        const ww = rw * (0.92 + 0.14 * Math.sin(S.t * sp * 0.83 + ph * 1.7));
        const dx = Math.sin(S.t * sp * 0.6 + ph) * w * R.amp * 1.6;
        const a = env * R.a * dim * (pass ? 0.45 : 1);
        if (a <= 0.01) continue;

        c.save();
        c.transform(1, 0, k, 1, 0, 0);           // se compose avec la caméra
        c.globalAlpha = cl(a, 0, 1);
        // le cisaillement décale déjà le haut du voile : on le compense pour
        // que le ruban reste là où le thème l'a placé.
        c.drawImage(spr, x0 + dx - k * top, top, ww, hh);
        c.restore();
      }
    }
    c.globalAlpha = 1;
    c.restore();
  }

  /* ========================================================================
   *  RÉACTIONS AU JEU — pulses, intensité, danger
   * ===================================================================== */

  function autoIntensity() {
    let v = 0.10;
    try {
      if (typeof gameState !== 'undefined' && gameState === 'playing') {
        v = 0.16;
        if (typeof enemies !== 'undefined' && enemies) v += cl(enemies.length / 20, 0, 0.42);
        if (typeof getComboMultiplier === 'function') {
          const m = getComboMultiplier();
          const max = (typeof TEMPO !== 'undefined' && TEMPO.COMBO_MAX) || 8;
          v += cl((m - 1) / max, 0, 1) * 0.42;
        }
      }
    } catch (e) { /* le fond ne dépend jamais du jeu pour tourner */ }
    return cl(v, 0, 1);
  }

  function autoDanger() {
    try {
      if (typeof gameState !== 'undefined' && gameState !== 'playing') return 0;
      if (typeof player !== 'undefined' && player && typeof player.lives === 'number') {
        return player.lives <= 1 ? 1 : 0;
      }
    } catch (e) { /* ignoré */ }
    return 0;
  }

  function updatePulses(dt) {
    let e = 0;
    for (let i = S.pulses.length - 1; i >= 0; i--) {
      const p = S.pulses[i];
      p.e *= Math.pow(0.015, dt);
      p.r += p.spd * dt;
      if (p.e < 0.01) { S.pulses.splice(i, 1); continue; }
      e += p.e;
    }
    S.pulseE = cl(e, 0, 1.6);
  }

  function drawPulses(c, w, h) {
    if (!S.pulses.length) return;
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < S.pulses.length; i++) {
      const p = S.pulses[i];
      const a = p.e;
      if (a <= 0.012) continue;
      // Un seul sprite pré-rendu, étiré : chute douce, aucun bord visible,
      // aucun gradient alloué au runtime — c'est la règle du module.
      const spr = pulseSprite(p.col);
      const d = p.r * 3.4;
      c.globalAlpha = cl(a * 0.10, 0, 1);
      c.drawImage(spr, p.x - d / 2, p.y - d / 2, d, d);
    }
    // voile général : le ciel entier respire avec l'action
    if (S.pulseE > 0.05) {
      //  LE VOILE GÉNÉRAL RESTE UN SOUPÇON. Mesuré après bloom : à 0,06 et
      //  avec cinq kills simultanés (le régime NORMAL de ce jeu), tout l'écran
      //  virait au magenta et on ne distinguait plus les projectiles ennemis.
      //  Le fond doit RESPIRER avec l'action, pas la recouvrir.
      c.globalAlpha = cl(S.pulseE * 0.011, 0, 0.032);
      c.fillStyle = S.pulses[S.pulses.length - 1].col;
      c.fillRect(-40, -40, w + 80, h + 80);
    }
    c.globalAlpha = 1;
    c.restore();
  }

  function drawDangerWash(c, w, h) {
    if (S.danger <= 0.01) return;
    // Battement de cœur : lent, sourd, impossible à ignorer.
    const beat = 0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.sin(S.t * 4.1), 3);
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = S.danger * (0.016 + 0.026 * beat);
    c.fillStyle = DANGER_COL;
    c.fillRect(-40, -40, w + 80, h + 80);
    c.restore();
  }

  /* ========================================================================
   *  CONSTRUCTION / CYCLE DE VIE
   * ===================================================================== */

  function queueRebuild(what) {
    if (S.pending.indexOf(what) < 0) S.pending.push(what);
  }

  /** Traite UNE reconstruction par frame : un changement de thème ne doit
   *  jamais coûter 5 ms d'un coup. */
  function processPending() {
    if (!S.pending.length) return;
    const what = S.pending.shift();
    try {
      if (what === 'neb') S.neb = buildNebula(S.theme, S.w, S.h);
      else if (what === 'body') S.body = buildBody(S.theme, S.w, S.h);
      else if (what === 'danger') S.dangerNeb = buildDangerNebula(S.w, S.h);
      else if (what === 'parts') buildParticles(S.theme, S.w, S.h);
    } catch (e) {
      console.warn('BACKDROP : reconstruction « ' + what + ' » impossible.', e);
    }
  }

  function ensure() {
    if (S.broken) return false;
    if (typeof PALETTE === 'undefined' || typeof NEON === 'undefined') return false;

    const w = Math.max(1, Math.round(CANVAS_WIDTH));
    const h = Math.max(1, Math.round(CANVAS_HEIGHT));
    if (w !== S.w || h !== S.h) {
      S.w = w; S.h = h;
      S.neb = null; S.nebPrev = null;
      S.body = null; S.bodyPrev = null;
      S.dangerNeb = null;
      S.sprites = {};
      S.permRib = null;
      S.pending.length = 0;
      queueRebuild('neb'); queueRebuild('body'); queueRebuild('parts'); queueRebuild('danger');
      S.fade = 1; S.fading = false;
      // le premier thème doit exister IMMÉDIATEMENT : on paie la nébuleuse tout
      // de suite (≈1 ms) et on étale le reste.
      processPending();
    }
    return true;
  }

  function applyTheme(i, immediate) {
    const idx = ((i | 0) % THEMES.length + THEMES.length) % THEMES.length;
    if (idx === S.idx && S.neb) return;
    S.nebPrev = S.neb;
    S.bodyPrev = S.body;
    S.nebPrevOff = S.nebOff;
    S.idx = idx;
    S.theme = THEMES[idx];
    S.neb = null;
    S.body = null;
    S.permRib = null;
    S.fade = 0;
    S.fading = true;
    S.sigSwap = true;             // les particules s'effacent puis renaissent
    S.version++;                  // stars.js reconstruira ses couches teintées
    S.pending.length = 0;
    queueRebuild('neb');
    queueRebuild('body');
    if (immediate) { processPending(); processPending(); }
  }

  /* ========================================================================
   *  UPDATE
   * ===================================================================== */

  function update(dt) {
    if (!ensure()) return;
    if (S.updFrame === FRAME.frame) return;      // une seule avance par frame
    S.updFrame = FRAME.frame;

    dt = (typeof dt === 'number' && isFinite(dt)) ? cl(dt, 0, 0.1) : 0;
    S.t += dt;

    processPending();

    // --- thème automatique : il suit le stage SAUF ordre explicite ----------
    //  `S.manual` est indispensable : sans lui, un setTheme() manuel était
    //  écrasé DÈS LA FRAME SUIVANTE par le stage courant (mesuré : le thème
    //  revenait toujours au n°1). followStage() rend la main au stage.
    try {
      if (!S.manual && typeof stageSystem !== 'undefined' && stageSystem) {
        const st = stageSystem.currentStage | 0;
        if (st > 0 && st !== S.autoStage) {
          S.autoStage = st;
          applyTheme(st - 1, false);
        }
      }
    } catch (e) { /* ignoré */ }

    // --- cross-fade de thème ------------------------------------------------
    if (S.fading) {
      if (S.neb && S.body) {
        S.fade = Math.min(1, S.fade + dt / 0.9);
        if (S.fade >= 1) { S.fading = false; S.nebPrev = null; S.bodyPrev = null; }
      }
    }
    // la signature disparaît, on la remplace au creux, elle revient
    if (S.sigSwap) {
      S.sigFade -= dt / 0.35;
      if (S.sigFade <= 0) {
        S.sigFade = 0;
        S.sigSwap = false;
        buildParticles(S.theme, S.w, S.h);
      }
    } else if (S.sigFade < 1) {
      S.sigFade = Math.min(1, S.sigFade + dt / 0.55);
    }

    // --- réactions ----------------------------------------------------------
    S.intensityHold -= dt;
    const itarget = (S.intensityHold > 0) ? S.intensitySet : autoIntensity();
    S.intensity = dampTo(S.intensity, itarget, 0.02, dt);

    S.dangerHold -= dt;
    const dtarget = (S.dangerHold > 0) ? S.dangerSet : autoDanger();
    S.danger = dampTo(S.danger, dtarget, 0.06, dt);
    if (S.danger > 0.02 && !S.dangerNeb) queueRebuild('danger');

    updatePulses(dt);

    // --- position du corps : dérive lente, jamais de bouclage brutal --------
    if (S.body) {
      const b = S.theme.body;
      BODY_POS.x = b.x * S.w + Math.sin(S.t * 0.0211 + 1.3) * S.w * 0.035;
      BODY_POS.y = b.y * S.h + Math.sin(S.t * 0.0349) * S.h * 0.10;
      BODY_POS.r = S.body.R;
    } else {
      BODY_POS.x = S.theme.body.x * S.w;
      BODY_POS.y = S.theme.body.y * S.h;
      BODY_POS.r = Math.min(S.w, S.h) * S.theme.body.scale;
    }
    S.moonT += dt;

    // --- nébuleuse : défilement (accéléré par l'intensité) ------------------
    const nsp = (S.neb ? S.neb.speed : 10) * (1 + S.intensity * 0.9);
    S.nebOff = (S.nebOff + nsp * dt) % S.h;
    S.nebPrevOff = (S.nebPrevOff + nsp * dt) % S.h;

    updateParticles(dt, S.w, S.h);
    updateEvents(dt);

    // --- assombrissement du ciel (éclipse) ---------------------------------
    S.dim = dampTo(S.dim, eclipseCover() * 0.78, 0.02, dt);
  }

  /* ========================================================================
   *  DESSIN
   * ===================================================================== */

  function blitNebula(c, neb, off, alpha) {
    if (!neb || alpha <= 0.01) return;
    const w = S.w, h = S.h;
    // CLAMP OBLIGATOIRE : une valeur hors de [0,1] est SILENCIEUSEMENT IGNORÉE
    // par le canvas — globalAlpha garderait alors la valeur précédente et la
    // nébuleuse s'afficherait à pleine opacité (flash blanc sur une salve de
    // pulses, où le facteur peut dépasser 1,6).
    c.globalAlpha = cl(alpha, 0, 1);
    c.drawImage(neb.cv, 0, off - h, w, h);
    c.drawImage(neb.cv, 0, off, w, h);
  }

  /* ------------------------------------------------------------------------
   *  OCCULTATION — comment un corps « découpe » le ciel derrière lui.
   *
   *  Avec le bloom, la scène est un buffer TRANSPARENT : `destination-out`
   *  gomme réellement les étoiles, ce qui est exactement l'effet voulu.
   *  Sans bloom (quality 0), on dessine directement sur le canvas visible,
   *  déjà rempli d'un aplat opaque : y percer un trou laisserait voir la page.
   *  On repeint alors le fond de scène par-dessus — même silhouette, même
   *  lecture, aucun trou.
   * --------------------------------------------------------------------- */
  function beginPunch(c) {
    c.save();
    if (typeof NEON !== 'undefined' && NEON.isEnabled && NEON.isEnabled()) {
      c.globalCompositeOperation = 'destination-out';
      c.fillStyle = '#000';
    } else {
      c.globalCompositeOperation = 'source-over';
      c.fillStyle = (typeof PALETTE !== 'undefined' ? PALETTE.bg.base : '#05060f');
    }
    c.globalAlpha = 1;
  }

  function endPunch(c) { c.restore(); }

  /** Silhouette d'occultation du corps courant. Elle doit épouser CE QUI EST
   *  RÉELLEMENT DESSINÉ : un disque centré pour une planète, mais deux disques
   *  décalés pour une étoile double ou des lunes jumelles — sans quoi on
   *  gomme un rond d'étoiles là où il n'y a rien. */
  function punchBody(c) {
    if (!S.body || S.fade <= 0.5) return;
    const b = S.theme.body;
    const R = BODY_POS.r;
    const occ = S.body.occlude;
    if (!(occ > 0.01) || !(R > 0)) return;
    const X = BODY_POS.x, Y = BODY_POS.y;

    beginPunch(c);
    c.beginPath();
    if (b.kind === 'binary') {
      const d = R * 1.45;
      const ax = X - d * 0.62, ay = Y - R * 0.12;
      const bx = X + d * 0.62, by = Y + R * 0.18, br = R * 0.62;
      c.moveTo(ax + R * occ, ay);
      c.arc(ax, ay, R * occ, 0, TAU);
      c.moveTo(bx + br * occ, by);
      c.arc(bx, by, br * occ, 0, TAU);
    } else if (b.kind === 'twin') {
      const ax = X - R * 0.85, ay = Y - R * 0.30;
      const bx = X + R * 0.95, by = Y + R * 0.55, br = R * 0.66;
      c.moveTo(ax + R * occ, ay);
      c.arc(ax, ay, R * occ, 0, TAU);
      c.moveTo(bx + br * occ, by);
      c.arc(bx, by, br * occ, 0, TAU);
    } else {
      c.moveTo(X + R * occ, Y);
      c.arc(X, Y, R * occ, 0, TAU);
    }
    c.fill();
    endPunch(c);
  }

  /** Couches LOINTAINES : nébuleuse, aurore, brume. À dessiner SOUS les étoiles. */
  function drawDeep(c) {
    if (!c || !ensure()) return;
    if (S.frameDeep === FRAME.frame) return;
    S.frameDeep = FRAME.frame;
    const t0 = performance.now();

    const w = S.w, h = S.h;
    const skyDim = (1 - S.dim * 0.72);
    const nebA = skyDim * (1 - S.danger * 0.45) * (1 + S.pulseE * 0.18);

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.imageSmoothingEnabled = true;

    if (S.nebPrev && S.fade < 1) blitNebula(c, S.nebPrev, S.nebPrevOff, S.nebPrev.alpha * (1 - S.fade) * nebA);
    if (S.neb) blitNebula(c, S.neb, S.nebOff, S.neb.alpha * (S.nebPrev ? S.fade : 1) * nebA);

    // Tempête magnétique : la nébuleuse est doublée, décalée — les couleurs
    // « ondulent » sans qu'aucun pixel ne soit recoloré.
    //
    //  UN SEUL ÉCHO, PAS DEUX. Chaque écho coûte deux blits PLEIN ÉCRAN, soit
    //  ici 11 MPix de mélange ; la version à deux échos ajoutait 45 % au coût
    //  total du fond (mesuré) pour un dédoublement qu'on ne distinguait plus.
    //  L'écho saute entièrement en qualité dégradée.
    if (S.ev.storm && S.neb && RENDER_CONFIG.quality >= 2) {
      const e = S.ev.storm;
      const env = envelope(e, 1.2, 1.6);
      const dx = Math.sin(S.t * 2.3 + e.seed) * 20 * env;
      c.globalAlpha = cl(S.neb.alpha * 0.55 * env * skyDim, 0, 1);
      c.drawImage(S.neb.cv, dx, S.nebOff - h + 5, w, h);
      c.drawImage(S.neb.cv, dx, S.nebOff + 5, w, h);
    }

    // Dernière vie : le ciel vire au sang.
    if (S.danger > 0.01 && S.dangerNeb) {
      blitNebula(c, S.dangerNeb, (S.nebOff * 1.4) % h, S.dangerNeb.alpha * S.danger * skyDim);
    }

    c.globalAlpha = 1;
    c.restore();

    drawAurora(c, w, h);
    drawMist(c, w, h);

    S.lastMs = performance.now() - t0;
  }

  /** Couches PROCHES : planète, lunes, particules, événements, voiles réactifs.
   *  À dessiner PAR-DESSUS les couches d'étoiles (la planète les occulte). */
  function drawFront(c) {
    if (!c || !ensure()) return;
    if (S.frameFront === FRAME.frame) return;
    S.frameFront = FRAME.frame;
    const t0 = performance.now();

    const w = S.w, h = S.h;
    const b = S.theme.body;
    const skyDim = (1 - S.dim * 0.55);

    /* --- lunes DERRIÈRE le corps ------------------------------------------ */
    drawMoons(c, b, false, skyDim);

    /* --- occultation : la planète découpe les étoiles. C'est cette silhouette
     *     franche qui donne l'échelle — un disque lumineux, lui, ferait tache. */
    punchBody(c);

    /* --- le corps céleste (pré-rendu) ------------------------------------- */
    c.save();
    c.globalCompositeOperation = 'lighter';
    if (S.bodyPrev && S.fade < 1) {
      c.globalAlpha = (1 - S.fade) * skyDim;
      c.drawImage(S.bodyPrev.cv, BODY_POS.x - S.bodyPrev.pad, BODY_POS.y - S.bodyPrev.pad);
    }
    if (S.body) {
      c.globalAlpha = (S.bodyPrev ? S.fade : 1) * skyDim;
      c.drawImage(S.body.cv, BODY_POS.x - S.body.pad, BODY_POS.y - S.body.pad);
    }
    c.globalAlpha = 1;
    c.restore();

    /* --- faisceaux de pulsar (thème 10) : le seul élément animé du corps --- */
    if (b.beams && S.body && S.fade > 0.4) {
      const pulse = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(S.t * 1.7), 3);
      const ang = S.t * 0.22;
      const col = tri(b.glow2 || b.glow, b.core);
      const L = Math.max(w, h) * 1.2;
      for (let s = -1; s <= 1; s += 2) {
        const ax = Math.cos(ang) * s, ay = Math.sin(ang) * s * 0.55;
        NEON.line(c, BODY_POS.x, BODY_POS.y, BODY_POS.x + ax * L, BODY_POS.y + ay * L,
                  col, 2.4 * pulse, { alpha: 0.22 * pulse * skyDim, passes: 2, cap: 'butt' });
      }
    }

    /* --- lunes DEVANT ------------------------------------------------------ */
    drawMoons(c, b, true, skyDim);

    /* --- éclipse ----------------------------------------------------------- */
    drawEclipse(c);

    /* --- signature + événements -------------------------------------------- */
    drawParticles(c);
    drawStorm(c, w, h);
    drawMeteors(c);
    drawComet(c);

    /* --- réactions au jeu --------------------------------------------------- */
    drawPulses(c, w, h);
    drawDangerWash(c, w, h);

    S.lastMs += performance.now() - t0;
  }

  /** Les lunes sont les SEULS corps tracés par frame : deux ou trois points
   *  lumineux et un anneau d'orbite à peine visible. */
  function drawMoons(c, b, front, skyDim) {
    if (!b.moons || !b.moons.length || !S.body) return;
    const R = BODY_POS.r;
    for (let i = 0; i < b.moons.length; i++) {
      const m = b.moons[i];
      const a = S.moonT * m.sp * TAU * 0.16 + i * 2.1;
      const sy = Math.sin(a);
      if ((sy >= 0) !== front) continue;
      const x = BODY_POS.x + Math.cos(a) * R * m.orb;
      const y = BODY_POS.y + sy * R * m.orb * (m.tilt == null ? 0.3 : m.tilt);
      const col = tri(m.col);
      const sz = Math.max(1.6, R * m.size);
      const A = (front ? 1 : 0.42) * S.fade * skyDim;
      if (A <= 0.02) continue;

      //  UNE LUNE N'EST PAS UN GROS POINT. NEON.dot empile des disques pleins :
      //  passé ~8 px de rayon on ne voit plus une lumière mais trois ronds gris
      //  aux bords nets, posés comme un autocollant. Même vocabulaire que les
      //  planètes, en miniature : un halo doux PRÉ-RENDU, un limbe sourd, et
      //  LE croissant — dont l'orientation suit la position sur l'orbite.
      const halo = pulseSprite(col.glow);
      const d = sz * 5.5;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = cl(A * 0.12, 0, 1);
      c.drawImage(halo, x - d / 2, y - d / 2, d, d);
      c.restore();

      NEON.circle(c, x, y, sz, col, 0.9, { alpha: A * 0.28, passes: 3 });
      // croissant : un arc tourné vers la même lumière que la planète.
      // Trait FIN : sous le bloom, un arc épais se referme en pâté lumineux et
      // la lune redevient la grosse tache qu'on cherchait à éliminer.
      NEON.polyline(c, ellipsePts(x, y, sz, sz, a + 1.15, -1.15, 1.15, 12),
                    col, Math.max(1, sz * 0.18), { alpha: A * 0.85, passes: 4, cap: 'round' });
    }
  }

  function draw(c) {
    drawDeep(c);
    drawFront(c);
  }

  /* ========================================================================
   *  API
   * ===================================================================== */

  const api = {
    THEMES: THEMES,

    /** Change de thème (0..9, modulo). Cross-fade d'environ 0,9 s. */
    setTheme: function (i, immediate) {
      S.manual = true;                      // le stage ne reprend plus la main
      if (!ensure()) { S.idx = ((i | 0) % THEMES.length + THEMES.length) % THEMES.length; S.theme = THEMES[S.idx]; return; }
      applyTheme(i, immediate !== false);
    },

    /** Confort : stage 1..10 → thème 0..9. */
    setStage: function (n) { api.setTheme((n | 0) - 1); },

    /** Laisse à nouveau le thème suivre automatiquement le stage courant. */
    followStage: function () { S.manual = false; S.autoStage = -1; },

    update: update,
    draw: draw,
    drawDeep: drawDeep,
    drawFront: drawFront,

    /** Onde de couleur — à appeler aux explosions.
     *  @param color  clé PALETTE, hex, ou triplet
     *  @param force  0 → 1,5 (une grosse explosion vaut ~0,8)
     *  @param x,y    facultatif : centre de l'onde (défaut : centre de l'écran) */
    pulse: function (color, force, x, y) {
      if (!ensure()) return;
      const f = cl(force == null ? 0.5 : force, 0, 1.5);
      if (f <= 0.02) return;
      const t = PALETTE.get(color || 'shock');
      if (S.pulses.length > 7) S.pulses.shift();
      S.pulses.push({
        x: (x == null ? S.w * 0.5 : x),
        y: (y == null ? S.h * 0.5 : y),
        r: 40 + f * 90,
        spd: 260 + f * 520,
        e: f,
        col: t.glow
      });
    },

    /** Tension de l'action, 0 → 1 : accélère les étoiles, la nébuleuse et les
     *  particules, et rapproche les événements. Non rappelée pendant ~1,5 s,
     *  le fond revient à son estimation automatique. */
    setIntensity: function (v) {
      S.intensitySet = cl(Number(v) || 0, 0, 1);
      S.intensityHold = 1.5;
    },

    /** Virage au rouge. Automatique quand player.lives <= 1 ; cet appel force
     *  la valeur pendant ~1,5 s. */
    setDanger: function (v) {
      S.dangerSet = cl(Number(v) || 0, 0, 1);
      S.dangerHold = 1.5;
    },

    /** Déclenche un événement à la demande (debug, scénarisation) :
     *  'comet' | 'meteors' | 'eclipse' | 'storm' | 'aurora'. */
    trigger: function (kind) {
      if (!ensure()) return false;
      const k = String(kind || '').toLowerCase();
      if (EV_KINDS.indexOf(k) < 0) return false;
      if (S.ev[k]) return false;
      startEvent(k);
      return true;
    },

    /* ---- lecture, pour stars.js ---- */

    /** Teinte / densité / éclat des couches d'étoiles du thème courant. */
    starStyle: function () {
      const s = S.theme.star;
      // la dernière vie déteint aussi sur les étoiles
      const tint = S.danger > 0.05 ? PALETTE.mix(s.tint, DANGER_COL, S.danger * 0.55) : s.tint;
      return { tint: tint, mix: s.mix, density: s.density, alpha: s.alpha };
    },

    /** Change à chaque bascule de thème : stars.js s'en sert pour reconstruire
     *  ses couches teintées, et seulement à ce moment-là. */
    styleVersion: function () { return S.version; },

    /** Accélération demandée au champ d'étoiles (0 = repos). */
    warpBoost: function () { return S.intensity * 0.85; },

    /** Assombrissement du ciel demandé par l'éclipse, 0 → 1. */
    dim: function () { return S.dim; },

    /** true : la nébuleuse est gérée ici, stars.js ne doit plus dessiner la sienne. */
    handlesNebula: function () { return !!(S.neb || S.nebPrev); },

    /* ---- divers ---- */

    themeIndex: function () { return S.idx; },
    themeName: function () { return S.theme.name; },
    theme: function () { return S.theme; },

    /** Coût de rendu de la dernière frame, en ms (budget : ~1,5 ms). */
    lastMs: function () { return S.lastMs; },

    /** Photographie de l'état interne — mise au point et réglage. */
    debug: function () {
      return {
        theme: S.theme.name, idx: S.idx, manuel: S.manual,
        intensite: +S.intensity.toFixed(3), danger: +S.danger.toFixed(3),
        dim: +S.dim.toFixed(3), fondu: +S.fade.toFixed(2),
        pulses: S.pulses.length, evts: api.activeEvents(),
        prochainEvt: +S.nextEvent.toFixed(1), enAttente: S.pending.slice(),
        ms: +S.lastMs.toFixed(2)
      };
    },

    /** Événements actifs (debug). */
    activeEvents: function () {
      const out = [];
      for (let i = 0; i < EV_KINDS.length; i++) if (S.ev[EV_KINDS[i]]) out.push(EV_KINDS[i]);
      return out;
    },

    /** Force la reconstruction complète (changement de taille, debug). */
    invalidate: function () { S.w = 0; S.h = 0; },

    /** Remise à zéro douce : nouvelle partie, retour au menu. */
    reset: function () {
      setAberration(0);
      S.ev = {};
      S.pulses.length = 0;
      S.pulseE = 0;
      S.dim = 0;
      S.danger = 0;
      S.intensity = 0;
      S.intensityHold = 0;
      S.dangerHold = 0;
      S.nextEvent = rnd(6, 12);
      S.autoStage = -1;
      S.manual = false;
    }
  };

  return api;
})();

window.BACKDROP = BACKDROP;
