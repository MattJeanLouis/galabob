/* =============================================================================
 *  galabob — INTERFACE : boîte à outils néon (UIKIT) + écrans (menu, pause,
 *  game over, paramètres)
 * -----------------------------------------------------------------------------
 *  Tout est tracé en VECTEUR LUMINEUX. Aucun aplat, aucune police système en
 *  gros corps : les titres utilisent une fonte à traits maison (voir GLYPHS),
 *  les libellés une grotesque condensée du système, avec interlettrage.
 *
 *  RAPPELS D'ARCHITECTURE
 *  ----------------------
 *  • `ctx` est RÉAFFECTÉ par NEON.beginFrame() vers le buffer émissif : on lit
 *    donc toujours la globale `ctx` DANS les fonctions, jamais au chargement.
 *  • Tout ce qui est dessiné ici est bloomé automatiquement. Inutile d'ajouter
 *    des ombres partout : le post-traitement s'en charge.
 *  • Les écrans fixes s'animent avec FRAME.realTime (temps RÉEL) : ils doivent
 *    vivre même quand le temps de jeu est gelé (pause, hitstop).
 *  • Zéro dépendance externe, zéro module ES : scripts globaux uniquement.
 *
 *  BOUTONS
 *  -------
 *  Les écrans enregistrent leurs boutons pendant le dessin (UIKIT.button).
 *  Un écouteur de pointeur, installé ici, retrouve le bouton sous le curseur au
 *  clic et exécute son action. Les deux rectangles historiques gérés par
 *  js/core/input.js (« Activer le Son » et « Régler Volumes ») sont dessinés
 *  EXACTEMENT à leur position d'origine et marqués `legacy:true` : on leur donne
 *  un retour visuel de survol, mais on ne déclenche PAS l'action nous-mêmes,
 *  pour ne pas la jouer deux fois.
 * ========================================================================== */

const UIKIT = (function () {
  'use strict';

  /* ==========================================================================
   *  TYPOGRAPHIE
   * ======================================================================== */

  // Grotesque condensée : uniquement des familles présentes sur les systèmes,
  // aucun appel réseau. Repli progressif jusqu'à Arial.
  const FONT_UI = '"Avenir Next Condensed","HelveticaNeue-CondensedBold",' +
                  '"Roboto Condensed","Arial Narrow","Segoe UI",Arial,sans-serif';
  // Chiffres : chasse fixe, pour que le score qui roule ne tremble pas.
  const FONT_NUM = '"SF Mono","JetBrains Mono","Roboto Mono",Menlo,Consolas,' +
                   '"Courier New",monospace';

  /* --------------------------------------------------------------------------
   *  FONTE VECTORIELLE MAISON
   *  Chaque glyphe est une liste de traits, chaque trait une liste de points
   *  dans un carré unité : x de 0 (gauche) à 1 (droite), y de 0 (haut des
   *  capitales) à 1 (ligne de base). Les accents sortent au-dessus (y < 0).
   * ----------------------------------------------------------------------- */
  const GLYPHS = {
    'A': [[[0,1],[.5,0],[1,1]],[[.17,.62],[.83,.62]]],
    'B': [[[0,0],[0,1]],[[0,0],[.7,0],[.96,.2],[.96,.32],[.7,.5],[0,.5]],[[.7,.5],[.98,.68],[.98,.82],[.7,1],[0,1]]],
    'C': [[[1,.2],[.72,0],[.28,0],[0,.24],[0,.76],[.28,1],[.72,1],[1,.8]]],
    'D': [[[0,0],[0,1]],[[0,0],[.6,0],[1,.3],[1,.7],[.6,1],[0,1]]],
    'E': [[[1,0],[0,0],[0,1],[1,1]],[[0,.5],[.75,.5]]],
    'F': [[[1,0],[0,0],[0,1]],[[0,.5],[.72,.5]]],
    'G': [[[1,.2],[.72,0],[.28,0],[0,.24],[0,.76],[.28,1],[.75,1],[1,.8],[1,.55],[.55,.55]]],
    'H': [[[0,0],[0,1]],[[1,0],[1,1]],[[0,.5],[1,.5]]],
    'I': [[[.15,0],[.85,0]],[[.5,0],[.5,1]],[[.15,1],[.85,1]]],
    'J': [[[.85,0],[.85,.74],[.6,1],[.25,1],[0,.76]]],
    'K': [[[0,0],[0,1]],[[.95,0],[0,.55]],[[.34,.38],[1,1]]],
    'L': [[[0,0],[0,1],[.95,1]]],
    'M': [[[0,1],[0,0],[.5,.55],[1,0],[1,1]]],
    'N': [[[0,1],[0,0],[1,1],[1,0]]],
    'O': [[[.28,0],[.72,0],[1,.24],[1,.76],[.72,1],[.28,1],[0,.76],[0,.24],[.28,0]]],
    'P': [[[0,1],[0,0],[.72,0],[1,.22],[1,.4],[.72,.6],[0,.6]]],
    'Q': [[[.28,0],[.72,0],[1,.24],[1,.76],[.72,1],[.28,1],[0,.76],[0,.24],[.28,0]],[[.6,.68],[1,1.06]]],
    'R': [[[0,1],[0,0],[.72,0],[1,.22],[1,.4],[.72,.6],[0,.6]],[[.55,.6],[1,1]]],
    'S': [[[1,.16],[.72,0],[.28,0],[0,.2],[0,.34],[.26,.47],[.74,.53],[1,.66],[1,.82],[.72,1],[.26,1],[0,.84]]],
    'T': [[[0,0],[1,0]],[[.5,0],[.5,1]]],
    'U': [[[0,0],[0,.74],[.26,1],[.74,1],[1,.74],[1,0]]],
    'V': [[[0,0],[.5,1],[1,0]]],
    'W': [[[0,0],[.2,1],[.5,.42],[.8,1],[1,0]]],
    'X': [[[0,0],[1,1]],[[1,0],[0,1]]],
    'Y': [[[0,0],[.5,.52],[1,0]],[[.5,.52],[.5,1]]],
    'Z': [[[0,0],[1,0],[0,1],[1,1]]],

    '0': [[[.28,0],[.72,0],[1,.24],[1,.76],[.72,1],[.28,1],[0,.76],[0,.24],[.28,0]],[[.2,.82],[.8,.18]]],
    '1': [[[.15,.22],[.5,0],[.5,1]],[[.18,1],[.82,1]]],
    '2': [[[0,.22],[.28,0],[.72,0],[1,.22],[1,.4],[0,1],[1,1]]],
    '3': [[[0,0],[1,0],[.45,.44]],[[.38,.44],[.78,.44],[1,.64],[1,.8],[.74,1],[.28,1],[0,.84]]],
    '4': [[[.74,1],[.74,0],[0,.7],[1,.7]]],
    '5': [[[1,0],[.12,0],[.03,.44],[.7,.42],[1,.62],[1,.8],[.74,1],[.28,1],[0,.85]]],
    '6': [[[.9,.12],[.6,0],[.28,.02],[0,.34],[0,.78],[.26,1],[.72,1],[1,.78],[1,.62],[.72,.44],[.28,.44],[0,.6]]],
    '7': [[[0,0],[1,0],[.34,1]]],
    '8': [[[.28,0],[.72,0],[1,.18],[1,.32],[.72,.48],[.28,.48],[0,.32],[0,.18],[.28,0]],[[.28,.48],[0,.66],[0,.84],[.28,1],[.72,1],[1,.84],[1,.66],[.72,.48]]],
    '9': [[[.1,.88],[.4,1],[.72,.98],[1,.66],[1,.22],[.74,0],[.28,0],[0,.22],[0,.38],[.28,.56],[.72,.56],[1,.4]]],

    ' ': [],
    '-': [[[.12,.52],[.88,.52]]],
    '_': [[[.05,1],[.95,1]]],
    '.': [[[.44,.95],[.56,.95]]],
    ',': [[[.56,.9],[.42,1.1]]],
    ':': [[[.5,.28],[.5,.4]],[[.5,.74],[.5,.86]]],
    '/': [[[0,1],[1,0]]],
    '\\':[[[0,0],[1,1]]],
    '*': [[[.5,.18],[.5,.82]],[[.2,.34],[.8,.66]],[[.8,.34],[.2,.66]]],
    '×': [[[.16,.28],[.84,.84]],[[.84,.28],[.16,.84]]],
    '!': [[[.5,0],[.5,.66]],[[.5,.92],[.5,.99]]],
    '?': [[[0,.22],[.28,0],[.72,0],[1,.22],[1,.36],[.5,.56],[.5,.68]],[[.5,.92],[.5,.99]]],
    '+': [[[.5,.25],[.5,.79]],[[.23,.52],[.77,.52]]],
    '=': [[[.15,.4],[.85,.4]],[[.15,.66],[.85,.66]]],
    '>': [[[.28,.2],[.76,.5],[.28,.8]]],
    '<': [[[.72,.2],[.24,.5],[.72,.8]]],
    '(': [[[.68,0],[.4,.3],[.4,.7],[.68,1]]],
    ')': [[[.32,0],[.6,.3],[.6,.7],[.32,1]]],
    '[': [[[.7,0],[.34,0],[.34,1],[.7,1]]],
    ']': [[[.3,0],[.66,0],[.66,1],[.3,1]]],
    '%': [[[.05,.9],[.95,.1]],[[.05,.28],[.28,.28]],[[.72,.72],[.95,.72]]],
    '·': [[[.46,.5],[.54,.5]]],
    '•': [[[.42,.5],[.58,.5]]],
    '→': [[[.05,.5],[.9,.5]],[[.62,.28],[.95,.5],[.62,.72]]],
    '▸': [[[.34,.24],[.78,.5],[.34,.76]]]
  };

  // Diacritiques : trait ajouté au-dessus (ou sous) la lettre de base.
  const MARKS = {
    acute: [[.38,-.1],[.68,-.3]],
    grave: [[.32,-.3],[.62,-.1]],
    circ:  [[.28,-.12],[.5,-.32],[.72,-.12]],
    trema: null,   // traité à part (deux points)
    ced:   [[.5,1],[.58,1.14],[.4,1.2]]
  };

  const ACCENTED = {
    'É': ['E','acute'], 'È': ['E','grave'], 'Ê': ['E','circ'],
    'À': ['A','grave'], 'Â': ['A','circ'],
    'Ç': ['C','ced'],
    'Î': ['I','circ'],  'Ï': ['I','trema'],
    'Ô': ['O','circ'],
    'Ù': ['U','grave'], 'Û': ['U','circ']
  };

  /* ==========================================================================
   *  PRÉFÉRENCES D'AFFICHAGE (persistées, réglables depuis l'écran Paramètres)
   * ======================================================================== */

  const reduceMotion = (function () {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) { return false; }
  })();

  function loadPrefs() {
    try {
      const q = localStorage.getItem('ui.quality');
      if (q !== null && typeof NEON !== 'undefined' && NEON.setQuality) {
        const v = parseInt(q, 10);
        if (v >= 0 && v <= 3) NEON.setQuality(v);
      }
      const sh = localStorage.getItem('ui.shake');
      if (sh !== null && typeof JUICE !== 'undefined' && JUICE.config) {
        JUICE.config.enabled = (sh === 'true');
      }
    } catch (e) { /* localStorage indisponible : on garde les défauts */ }
    if (reduceMotion) {
      try { if (typeof JUICE !== 'undefined' && JUICE.config) JUICE.config.maxHitstopMs = 120; } catch (e) {}
    }
  }

  function savePref(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (e) { /* ignoré */ }
  }

  /* ==========================================================================
   *  OUTILS GÉNÉRIQUES
   * ======================================================================== */

  /** Facteur d'échelle de l'interface : 1 sur un écran ~1280x800. */
  function scale() {
    const s = Math.min(CANVAS_WIDTH / 1280, CANVAS_HEIGHT / 800);
    return clamp(s, 0.56, 1.6);
  }

  function inRect(px, py, x, y, w, h) {
    return px >= x && px <= x + w && py >= y && py <= y + h;
  }

  /** Ressort amorti : dépassement puis stabilisation. t en secondes. */
  function spring(t, freq, damping) {
    if (t <= 0) return 0;
    const f = freq == null ? 9 : freq;
    const d = damping == null ? 7 : damping;
    return 1 - Math.exp(-d * t) * Math.cos(f * t);
  }

  function easeOutBack(p) {
    p = clamp(p, 0, 1);
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
  }

  function easeOutCubic(p) { p = clamp(p, 0, 1); return 1 - Math.pow(1 - p, 3); }

  /** Oscillation douce, amplitude réduite si l'utilisateur limite les animations. */
  function osc(hz, amp, phase) {
    const a = reduceMotion ? amp * 0.25 : amp;
    return Math.sin((FRAME.realTime * hz * Math.PI * 2) + (phase || 0)) * a;
  }

  /** Bruit pseudo-aléatoire déterministe (pour les glitches, sans scintillement
   *  incontrôlé d'une frame à l'autre). */
  function hash01(n) {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  }

  /* ==========================================================================
   *  FONDS
   * ======================================================================== */

  /** Voile sombre (assombrit ce qui est déjà peint, contrairement à un aplat
   *  additif). À n'utiliser que sur les écrans, jamais en pleine action. */
  function veil(c, alpha, colorHex) {
    if (!c || !(alpha > 0)) return;
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = PALETTE.rgba(colorHex || PALETTE.bg.deep, alpha);
    c.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    c.restore();
  }

  // Motif de lignes de balayage, créé une seule fois par contexte.
  const _scan = { ctx: null, pat: null };
  function scanlines(c, alpha) {
    if (!c || !(alpha > 0)) return;
    if (_scan.ctx !== c || !_scan.pat) {
      try {
        const cv = document.createElement('canvas');
        cv.width = 2; cv.height = 4;
        const g = cv.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, 2, 1.4);
        _scan.pat = c.createPattern(cv, 'repeat');
        _scan.ctx = c;
      } catch (e) { _scan.pat = null; }
    }
    if (!_scan.pat) return;
    c.save();
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = alpha;
    c.fillStyle = _scan.pat;
    c.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    c.restore();
  }

  /** Grille en perspective qui défile vers le spectateur — le sol vectoriel.
   *  Deux tracés seulement (une passe pour tout le maillage). */
  function horizonGrid(c, opts) {
    opts = opts || {};
    const speed = opts.speed == null ? 0.20 : opts.speed;
    const t = FRAME.realTime * (reduceMotion ? speed * 0.3 : speed);
    const hz = CANVAS_HEIGHT * (opts.horizon == null ? 0.60 : opts.horizon);
    const bottom = CANVAS_HEIGHT + 4;
    const cx = CANVAS_WIDTH / 2;
    const rows = 10, cols = 14;

    const p = new Path2D();
    const frac = t - Math.floor(t);
    for (let i = 0; i < rows; i++) {
      const f = (i + frac) / rows;
      const yy = hz + (bottom - hz) * f * f;
      p.moveTo(0, yy);
      p.lineTo(CANVAS_WIDTH, yy);
    }
    for (let i = 0; i <= cols; i++) {
      const u = i / cols - 0.5;
      p.moveTo(cx + u * CANVAS_WIDTH * 0.05, hz);
      p.lineTo(cx + u * CANVAS_WIDTH * 2.1, bottom);
    }
    NEON.custom(c, p, opts.color || 'player', opts.width == null ? 1 : opts.width, {
      alpha: opts.alpha == null ? 0.13 : opts.alpha,
      halo: false, passes: 2, cap: 'butt'
    });
  }

  /** Poussières lumineuses en dérive — calculées, sans état ni allocation. */
  function driftDust(c, count, color, alpha) {
    const n = count == null ? 22 : count;
    const t = FRAME.realTime;
    for (let i = 0; i < n; i++) {
      const s1 = hash01(i * 3.7 + 1.3);
      const s2 = hash01(i * 9.1 + 4.7);
      const s3 = 0.4 + hash01(i * 5.3 + 2.9) * 0.9;
      const x = (CANVAS_WIDTH * s1 + Math.sin(t * 0.17 * s3 + i) * 60 + CANVAS_WIDTH) % CANVAS_WIDTH;
      const y = (CANVAS_HEIGHT * s2 + t * 12 * s3) % CANVAS_HEIGHT;
      const r = 0.7 + s3 * 1.1;
      NEON.dot(c, x, y, r, color || 'star', { alpha: (alpha == null ? 0.5 : alpha) * (0.35 + s3 * 0.5) });
    }
  }

  /* ==========================================================================
   *  TEXTE
   * ======================================================================== */

  /** Largeur d'un libellé interlettré, en px CSS. */
  function labelWidth(c, str, size, tracking, font, weight) {
    if (!c || !str) return 0;
    c.save();
    c.font = (weight || '600') + ' ' + size + 'px ' + (font || FONT_UI);
    let w = 0;
    for (let i = 0; i < str.length; i++) w += c.measureText(str.charAt(i)).width;
    c.restore();
    return w + (tracking || 0) * Math.max(0, str.length - 1);
  }

  /** Libellé lumineux à interlettrage contrôlé.
   *  Deux passes additives (halo + noyau) ; le bloom fait le reste.
   *  opts : {size, tracking, align, alpha, weight, font, baseline, mono} */
  function label(c, str, x, y, color, opts) {
    if (!c || str == null) return 0;
    str = String(str);
    opts = opts || {};
    const size = opts.size == null ? 13 : opts.size;
    const tracking = opts.tracking == null ? size * 0.22 : opts.tracking;
    const font = opts.font || (opts.mono ? FONT_NUM : FONT_UI);
    const weight = opts.weight || '600';
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    if (alpha <= 0.004) return 0;

    const col = PALETTE.get(color || 'ui');
    const total = labelWidth(c, str, size, tracking, font, weight);
    let sx = x;
    if (opts.align === 'center') sx = x - total / 2;
    else if (opts.align === 'right') sx = x - total;

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.font = weight + ' ' + size + 'px ' + font;
    c.textAlign = 'left';
    c.textBaseline = opts.baseline || 'alphabetic';

    // passe halo
    c.fillStyle = col.glow;
    c.globalAlpha = alpha * (opts.glowAlpha == null ? 0.9 : opts.glowAlpha);
    let cx = sx;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charAt(i);
      c.fillText(ch, cx, y);
      cx += c.measureText(ch).width + tracking;
    }
    // passe noyau
    if (opts.core !== false) {
      c.fillStyle = col.core;
      c.globalAlpha = alpha * (opts.coreAlpha == null ? 0.75 : opts.coreAlpha);
      cx = sx;
      for (let i = 0; i < str.length; i++) {
        const ch = str.charAt(i);
        c.fillText(ch, cx, y);
        cx += c.measureText(ch).width + tracking;
      }
    }
    c.restore();
    return total;
  }

  /* ---------------------------- fonte vectorielle ------------------------ */

  function vectorMetrics(str, size, opts) {
    opts = opts || {};
    const aspect = opts.aspect == null ? 0.62 : opts.aspect;
    const gw = size * aspect;
    const tracking = opts.tracking == null ? size * 0.26 : opts.tracking;
    const n = String(str).length;
    return { gw: gw, tracking: tracking, width: n > 0 ? n * gw + (n - 1) * tracking : 0 };
  }

  function addStroke(path, pts, gx, gy, gw, size, slant) {
    for (let i = 0; i < pts.length; i++) {
      const u = pts[i][0], v = pts[i][1];
      const px = gx + u * gw + (1 - v) * slant * size;
      const py = gy + v * size;
      if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
    }
  }

  function addGlyph(path, ch, gx, gy, gw, size, slant) {
    let base = ch, mark = null;
    const acc = ACCENTED[ch];
    if (acc) { base = acc[0]; mark = acc[1]; }
    const strokes = GLYPHS[base];
    if (strokes) {
      for (let s = 0; s < strokes.length; s++) addStroke(path, strokes[s], gx, gy, gw, size, slant);
    }
    if (mark === 'trema') {
      addStroke(path, [[.3,-.22],[.38,-.22]], gx, gy, gw, size, slant);
      addStroke(path, [[.62,-.22],[.7,-.22]], gx, gy, gw, size, slant);
    } else if (mark && MARKS[mark]) {
      addStroke(path, MARKS[mark], gx, gy, gw, size, slant);
    }
  }

  /** Construit le Path2D d'une chaîne en fonte vectorielle.
   *  `y` est le HAUT des capitales. Retourne {path, width, x}. */
  function vectorPath(str, x, y, size, opts) {
    opts = opts || {};
    str = String(str).toUpperCase();
    const m = vectorMetrics(str, size, opts);
    let sx = x;
    if (opts.align === 'center') sx = x - m.width / 2;
    else if (opts.align === 'right') sx = x - m.width;
    const slant = opts.slant || 0;
    const p = new Path2D();
    for (let i = 0; i < str.length; i++) {
      addGlyph(p, str.charAt(i), sx + i * (m.gw + m.tracking), y, m.gw, size, slant);
    }
    return { path: p, width: m.width, x: sx };
  }

  /** Texte en fonte vectorielle : UN seul tracé néon pour toute la chaîne. */
  function vector(c, str, x, y, size, color, opts) {
    opts = opts || {};
    const vp = vectorPath(str, x, y, size, opts);
    const w = opts.width == null ? Math.max(1.1, size * 0.085) : opts.width;
    NEON.custom(c, vp.path, color || 'ui', w, opts);
    return vp.width;
  }

  function vectorWidth(str, size, opts) {
    return vectorMetrics(String(str), size, opts).width;
  }

  /** Titre : fonte vectorielle + doublure décalée en teinte complémentaire.
   *  C'est ce décalage qui donne la profondeur « borne d'arcade ». */
  function vectorTitle(c, str, x, y, size, color, opts) {
    opts = opts || {};
    const alt = opts.altColor || PALETTE.ui.accentAlt;
    const off = opts.offset == null ? Math.max(2, size * 0.045) : opts.offset;
    const a = opts.alpha == null ? 1 : opts.alpha;
    const glitch = opts.glitch || 0;

    // doublure magenta décalée
    vector(c, str, x + off, y + off * 0.55, size, alt, {
      align: opts.align, slant: opts.slant, tracking: opts.tracking, aspect: opts.aspect,
      alpha: a * 0.38, width: opts.width, glowScale: 1.05, passes: 3
    });
    // doublure cyan opposée
    vector(c, str, x - off * 0.7, y - off * 0.4, size, opts.altColor2 || PALETTE.ui.accent, {
      align: opts.align, slant: opts.slant, tracking: opts.tracking, aspect: opts.aspect,
      alpha: a * 0.26, width: opts.width, glowScale: 1.05, passes: 3
    });
    // glitch : tranche décalée, déterministe (pas de scintillement aléatoire)
    if (glitch > 0) {
      const seed = Math.floor(FRAME.realTime * 7);
      if (hash01(seed) < glitch) {
        const dx = (hash01(seed + 11) - 0.5) * size * 0.5;
        c.save();
        c.beginPath();
        const sliceY = y + hash01(seed + 3) * size * 0.8;
        c.rect(0, sliceY, CANVAS_WIDTH, size * (0.08 + hash01(seed + 5) * 0.16));
        c.clip();
        vector(c, str, x + dx, y, size, PALETTE.ui.warn, {
          align: opts.align, slant: opts.slant, tracking: opts.tracking,
          aspect: opts.aspect, alpha: a * 0.9, width: opts.width
        });
        c.restore();
      }
    }
    // corps principal
    return vector(c, str, x, y, size, color, {
      align: opts.align, slant: opts.slant, tracking: opts.tracking, aspect: opts.aspect,
      alpha: a, width: opts.width, glowScale: opts.glowScale
    });
  }

  /* ==========================================================================
   *  PRIMITIVES D'INTERFACE
   * ======================================================================== */

  /** Cadre en équerres — plus vectoriel qu'un rectangle fermé. */
  function bracketFrame(c, x, y, w, h, color, opts) {
    opts = opts || {};
    const L = opts.corner == null ? Math.min(w, h) * 0.28 : opts.corner;
    const p = new Path2D();
    p.moveTo(x, y + L);           p.lineTo(x, y);           p.lineTo(x + L, y);
    p.moveTo(x + w - L, y);       p.lineTo(x + w, y);       p.lineTo(x + w, y + L);
    p.moveTo(x + w, y + h - L);   p.lineTo(x + w, y + h);   p.lineTo(x + w - L, y + h);
    p.moveTo(x + L, y + h);       p.lineTo(x, y + h);       p.lineTo(x, y + h - L);
    NEON.custom(c, p, color, opts.width == null ? 1.6 : opts.width, opts);
  }

  /** Jauge horizontale : rail sombre + remplissage lumineux + tête de lecture.
   *  Si `segments` est fourni, la barre est découpée (rendu plus « machine »),
   *  et tout le maillage tient en deux tracés. */
  function bar(c, x, y, w, h, frac, color, opts) {
    opts = opts || {};
    frac = clamp(frac, 0, 1);
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    const segs = opts.segments || 0;

    if (segs > 1 && segs <= 60) {
      const gap = Math.max(1.5, w / segs * 0.28);
      const sw = (w - gap * (segs - 1)) / segs;
      const lit = frac * segs;
      const off = new Path2D();
      const on = new Path2D();
      for (let i = 0; i < segs; i++) {
        const sx = x + i * (sw + gap);
        const cover = clamp(lit - i, 0, 1);
        if (cover <= 0.001) {
          off.rect(sx, y, sw, h);
        } else {
          on.rect(sx, y, sw * cover, h);
          if (cover < 0.999) off.rect(sx + sw * cover, y, sw * (1 - cover), h);
        }
      }
      NEON.fillPath(c, off, color, { alpha: alpha * 0.16, core: false, glowAlpha: 0.5 });
      NEON.fillPath(c, on, color, { alpha: alpha, glowAlpha: 0.6, coreAlpha: 0.9 });
    } else {
      const rail = new Path2D(); rail.rect(x, y, w, h);
      NEON.fillPath(c, rail, color, { alpha: alpha * 0.14, core: false, glowAlpha: 0.5 });
      if (frac > 0.001) {
        const fill = new Path2D(); fill.rect(x, y, w * frac, h);
        NEON.fillPath(c, fill, color, { alpha: alpha, glowAlpha: 0.6, coreAlpha: 0.9 });
      }
    }

    // rail : filet inférieur pour ancrer la barre
    NEON.line(c, x, y + h + 1.5, x + w, y + h + 1.5, color, 1,
      { alpha: alpha * 0.22, halo: false, passes: 2, cap: 'butt' });

    // tête de lecture
    if (opts.head !== false && frac > 0.001 && frac < 0.999) {
      NEON.dot(c, x + w * frac, y + h / 2, h * 0.55, color, { alpha: alpha });
    }
  }

  /** Jauge circulaire : anneau de fond + arc de progression depuis le haut. */
  function arcGauge(c, x, y, r, frac, color, opts) {
    opts = opts || {};
    frac = clamp(frac, 0, 1);
    const width = opts.width == null ? 3 : opts.width;
    const alpha = opts.alpha == null ? 1 : opts.alpha;

    NEON.ring(c, x, y, r, width * 0.7, color, { alpha: alpha * 0.16, halo: false, passes: 2 });
    if (frac > 0.002) {
      const p = new Path2D();
      const start = -Math.PI / 2;
      p.arc(x, y, r, start, start + Math.PI * 2 * frac, !!opts.ccw);
      NEON.custom(c, p, color, width, { alpha: alpha, cap: 'round', glowScale: opts.glowScale });
    }
  }

  /** Touche de clavier stylisée. Retourne sa largeur. */
  function keycap(c, x, y, str, opts) {
    opts = opts || {};
    const size = opts.size == null ? 12 : opts.size;
    const padX = size * 0.62;
    const h = opts.height == null ? size * 1.9 : opts.height;
    const color = opts.color || PALETTE.ui.accent;
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    const tw = labelWidth(c, str, size, size * 0.14, FONT_UI, '700');
    const w = Math.max(h * 0.95, tw + padX * 2);

    const p = new Path2D();
    if (typeof p.roundRect === 'function') p.roundRect(x, y, w, h, Math.min(6, h * 0.28));
    else p.rect(x, y, w, h);
    NEON.fillPath(c, p, color, { alpha: alpha * 0.14, core: false, glowAlpha: 0.6 });
    NEON.strokePath(c, p, color, 1.3, { alpha: alpha * 0.8 });
    label(c, str, x + w / 2, y + h / 2 + size * 0.36, color, {
      size: size, tracking: size * 0.14, align: 'center', alpha: alpha, weight: '700'
    });
    return w;
  }

  /** Petite silhouette de vaisseau vectorielle (icône de vie, curseur de menu).
   *  Ajoutée à un Path2D existant pour ne faire qu'un seul tracé néon. */
  function addShipGlyph(path, cx, cy, size) {
    const w = size, h = size * 1.1;
    path.moveTo(cx, cy - h * 0.55);
    path.lineTo(cx + w * 0.5, cy + h * 0.42);
    path.lineTo(cx + w * 0.18, cy + h * 0.22);
    path.lineTo(cx, cy + h * 0.5);
    path.lineTo(cx - w * 0.18, cy + h * 0.22);
    path.lineTo(cx - w * 0.5, cy + h * 0.42);
    path.closePath();
  }

  /* ==========================================================================
   *  BOUTONS ET POINTEUR
   * ======================================================================== */

  const pointer = { x: -9999, y: -9999, over: false };
  const anim = Object.create(null);
  let frameButtons = [];
  let liveButtons = [];
  let currentScreen = '';
  let cursorKind = '';

  // Naissance et dernière frame de dessin de chaque écran. Deux écrans peuvent
  // être peints dans la MÊME frame (le HUD puis le menu pause) : chacun garde
  // donc sa propre horloge d'apparition, sinon leurs animations se piétinent.
  const screenBorn = Object.create(null);
  const screenSeen = Object.create(null);

  function animOf(id) {
    let a = anim[id];
    if (!a) a = anim[id] = { hover: 0, press: 0, born: FRAME.realTime };
    return a;
  }

  function setCursor(kind) {
    if (kind === cursorKind) return;
    cursorKind = kind;
    try {
      const cv = document.getElementById('gameCanvas');
      if (cv) cv.style.cursor = kind;
    } catch (e) { /* ignoré */ }
  }

  /** À appeler au début du dessin d'un écran.
   *  @returns {boolean} true si l'écran vient (ré)apparaître : c'est le signal
   *  pour réarmer les compteurs qui roulent. */
  function beginScreen(name) {
    currentScreen = name;
    frameButtons = [];
    const reborn = (screenSeen[name] !== FRAME.frame - 1) && (screenSeen[name] !== FRAME.frame);
    if (reborn) screenBorn[name] = FRAME.realTime;
    screenSeen[name] = FRAME.frame;
    return reborn;
  }

  /** Temps écoulé depuis l'apparition de l'écran courant (secondes réelles). */
  function screenAge() {
    const b = screenBorn[currentScreen];
    return b == null ? 0 : Math.max(0, FRAME.realTime - b);
  }

  /** Entrée retardée : 0 → 1 avec dépassement, décalée de `delay` secondes. */
  function enter(delay, dur) {
    const t = screenAge() - (delay || 0);
    if (t <= 0) return 0;
    return easeOutBack(t / (dur == null ? 0.42 : dur));
  }

  /** À appeler à la fin du dessin d'un écran.
   *  @param {string} [idleCursor] curseur quand rien n'est survolé
   *         ('none' en jeu : le pointeur n'a rien à faire au milieu de l'action). */
  function endScreen(idleCursor) {
    liveButtons = frameButtons;
    let over = false;
    for (let i = 0; i < liveButtons.length; i++) {
      const b = liveButtons[i];
      if (!b.legacy && b.action && inRect(pointer.x, pointer.y, b.x, b.y, b.w, b.h)) { over = true; break; }
    }
    setCursor(over ? 'pointer' : (idleCursor || 'default'));
  }

  /** Dessine et enregistre un bouton.
   *  def : {id, x, y, w, h, label, hint, action, legacy, color, primary,
   *         size, align, icon} */
  function button(c, def) {
    const a = animOf(def.id);
    const dt = FRAME.rawDt;
    const hovered = inRect(pointer.x, pointer.y, def.x, def.y, def.w, def.h);
    const target = hovered ? 1 : 0;
    a.hover = damp(a.hover, target, 0.0004, dt);
    a.press = damp(a.press, 0, 0.0002, dt);

    const color = def.color || PALETTE.ui.accent;
    const h = a.hover;
    const pr = a.press;
    const pulse = def.primary ? 0.5 + 0.5 * Math.sin(FRAME.realTime * 3.4) : 0;
    const glowA = (def.alpha == null ? 1 : def.alpha) * (0.62 + h * 0.38 + pulse * 0.12 + pr * 0.4);

    // fond
    const bg = new Path2D();
    bg.rect(def.x, def.y, def.w, def.h);
    NEON.fillPath(c, bg, color, {
      alpha: (0.05 + h * 0.16 + pr * 0.25) * (def.alpha == null ? 1 : def.alpha),
      core: false, glowAlpha: 0.9
    });

    // équerres qui s'écartent au survol
    const grow = h * 5 + pr * 4;
    bracketFrame(c, def.x - grow, def.y - grow * 0.5, def.w + grow * 2, def.h + grow,
      color, {
        corner: Math.min(def.w, def.h) * (0.26 + h * 0.16),
        width: 1.5 + h * 0.8,
        alpha: glowA
      });

    // filet de base qui se remplit au survol
    const underY = def.y + def.h - 1;
    NEON.line(c, def.x + 6, underY, def.x + 6 + (def.w - 12) * (0.12 + h * 0.88), underY,
      color, 1.8, { alpha: glowA * 0.9, cap: 'butt' });

    // libellé
    const size = def.size == null ? 17 : def.size;
    // Le libellé se centre dans la place RESTANTE : sur un bouton étroit, il ne
    // vient pas buter contre la touche de raccourci affichée à droite.
    const hintSpace = def.hint ? (def.hintW || 60) + 16 : 0;
    const tx = def.align === 'left'
      ? def.x + def.h * 0.55
      : def.x + (def.w - hintSpace) / 2;
    const baseA = (def.alpha == null ? 1 : def.alpha);
    label(c, def.label, tx + (def.labelDx || 0), def.y + def.h / 2 + size * 0.36, color, {
      size: size,
      tracking: size * (0.2 + h * 0.1),
      align: def.align === 'left' ? 'left' : 'center',
      alpha: baseA * (0.75 + h * 0.25 + pr * 0.3),
      weight: '700'
    });

    // curseur en forme de vaisseau, à gauche, quand survolé/primaire
    const sel = Math.max(h, def.primary ? 0.55 + pulse * 0.45 : 0) * baseA;
    if (sel > 0.02) {
      const p = new Path2D();
      const px = def.x - 16 - sel * 8;
      const py = def.y + def.h / 2;
      p.moveTo(px - 7, py - 6); p.lineTo(px + 5, py); p.lineTo(px - 7, py + 6);
      NEON.custom(c, p, color, 2, { alpha: sel * 0.9 });
    }

    // rappel clavier
    if (def.hint) {
      keycap(c, def.x + def.w - 12 - (def.hintW || 60), def.y + def.h / 2 - def.h * 0.28,
        def.hint, { size: Math.max(10, size * 0.62), height: def.h * 0.56, color: color,
                    alpha: baseA * (0.55 + h * 0.45) });
    }

    frameButtons.push({
      id: def.id, x: def.x, y: def.y, w: def.w, h: def.h,
      action: def.action, legacy: !!def.legacy
    });
    return hovered;
  }

  /** Retour visuel d'appui (appelé par le gestionnaire de clic). */
  function flashButton(id) {
    const a = animOf(id);
    a.press = 1;
  }

  /* ------------------------------- pointeur ------------------------------ */

  function canvasRect() {
    const cv = document.getElementById('gameCanvas');
    if (!cv || !cv.getBoundingClientRect) return null;
    return cv.getBoundingClientRect();
  }

  function updatePointer(e) {
    const r = canvasRect();
    if (!r) return;
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.over = true;
  }

  function onPointerMove(e) { updatePointer(e); }

  function onPointerLeave() {
    pointer.x = -9999; pointer.y = -9999; pointer.over = false;
  }

  function onClick(e) {
    // Un clic sur le panneau audio HTML ne concerne pas le canvas.
    const cv = document.getElementById('gameCanvas');
    if (!cv || e.target !== cv) return;
    updatePointer(e);
    for (let i = liveButtons.length - 1; i >= 0; i--) {
      const b = liveButtons[i];
      if (!inRect(pointer.x, pointer.y, b.x, b.y, b.w, b.h)) continue;
      flashButton(b.id);
      // Retour sonore d'interface : SFX expose 'uiselect' / 'blip'. Sans le
      // module audio, gameEvent() est un no-op — aucun couplage.
      if (typeof gameEvent === 'function') gameEvent('uiSelect', { id: b.id });
      // Les boutons `legacy` sont traités par js/core/input.js : on ne double pas.
      if (!b.legacy && typeof b.action === 'function') {
        try { b.action(); } catch (err) { console.warn('Action de bouton en échec :', err); }
      }
      break;
    }
  }

  function installPointer() {
    try {
      document.addEventListener('pointermove', onPointerMove, { passive: true });
      document.addEventListener('pointerdown', updatePointer, { passive: true });
      document.addEventListener('pointerleave', onPointerLeave, { passive: true });
      document.addEventListener('click', onClick);
      window.addEventListener('blur', onPointerLeave);
    } catch (e) { /* environnement sans DOM : rien à faire */ }
  }

  installPointer();
  loadPrefs();

  /* ==========================================================================
   *  API PUBLIQUE
   * ======================================================================== */
  return {
    FONT_UI: FONT_UI,
    FONT_NUM: FONT_NUM,
    reduceMotion: reduceMotion,

    scale: scale,
    inRect: inRect,
    spring: spring,
    easeOutBack: easeOutBack,
    easeOutCubic: easeOutCubic,
    osc: osc,
    hash01: hash01,

    veil: veil,
    scanlines: scanlines,
    horizonGrid: horizonGrid,
    driftDust: driftDust,

    label: label,
    labelWidth: labelWidth,
    vector: vector,
    vectorWidth: vectorWidth,
    vectorPath: vectorPath,
    vectorTitle: vectorTitle,

    bracketFrame: bracketFrame,
    bar: bar,
    arcGauge: arcGauge,
    keycap: keycap,
    addShipGlyph: addShipGlyph,

    beginScreen: beginScreen,
    endScreen: endScreen,
    button: button,
    screenAge: screenAge,
    enter: enter,
    pointer: pointer,
    setCursor: setCursor,
    savePref: savePref,

    /** Rectangles historiques attendus par js/core/input.js.
     *  Exposés pour qu'un futur branchement puisse les lire au lieu de les
     *  coder en dur des deux côtés. */
    hitRects: {
      soundButton: function () {
        return { x: CANVAS_WIDTH / 2 - 100, y: CANVAS_HEIGHT / 2 + 120, width: 200, height: 40 };
      },
      volumeButton: function () {
        return { x: CANVAS_WIDTH / 2 - 100, y: CANVAS_HEIGHT / 2 - 40, width: 200, height: 40 };
      }
    }
  };
})();

window.UIKIT = UIKIT;

/* =============================================================================
 *  ÉTAT PARTAGÉ DES ÉCRANS
 * ========================================================================== */

const MENU_STATE = {
  bestShown: 0,       // meilleur score affiché (roulement)
  finalShown: 0       // score final du game over (roulement)
};

/** true si le son est actif (tolérant à une refonte du module audio). */
function uiSoundEnabled() {
  return !!(typeof audioConfig !== 'undefined' && audioConfig && audioConfig.soundEnabled);
}

/** true si le module audio a fini de recenser ses pistes.
 *  La variable `audioFilesReady` peut disparaître d'une refonte de audio.js :
 *  dans ce cas on considère l'audio comme prêt. */
function uiAudioReady() {
  return (typeof audioFilesReady === 'undefined') ? true : !!audioFilesReady;
}

/** Roulement générique d'un compteur affiché. */
function rollTowards(current, target, dt, rate) {
  if (!(dt > 0)) return current;
  if (Math.abs(target - current) < 0.6) return target;
  return damp(current, target, rate == null ? 0.0012 : rate, dt);
}

/* -----------------------------------------------------------------------------
 *  DÉCOR COMMUN À TOUS LES ÉCRANS
 * -------------------------------------------------------------------------- */
function drawScreenBackdrop(c, opts) {
  opts = opts || {};
  UIKIT.veil(c, opts.veil == null ? 0.62 : opts.veil);
  UIKIT.horizonGrid(c, {
    horizon: opts.horizon == null ? 0.62 : opts.horizon,
    alpha: opts.gridAlpha == null ? 0.16 : opts.gridAlpha,
    color: opts.gridColor || 'player'
  });
  if (opts.dust !== false) UIKIT.driftDust(c, 18, 'star', 0.45);
  UIKIT.scanlines(c, opts.scan == null ? 0.16 : opts.scan);

  // Encadrement de l'écran : deux filets aux bords, très discrets.
  const m = 14;
  const p = new Path2D();
  p.moveTo(m, m); p.lineTo(CANVAS_WIDTH - m, m);
  p.moveTo(m, CANVAS_HEIGHT - m); p.lineTo(CANVAS_WIDTH - m, CANVAS_HEIGHT - m);
  NEON.custom(c, p, 'player', 1, { alpha: 0.18, halo: false, passes: 2, cap: 'butt' });
}

/* =============================================================================
 *  MENU PRINCIPAL
 * ========================================================================== */
function drawMenu() {
  const c = ctx;
  const S = UIKIT.scale();
  const cx = CANVAS_WIDTH / 2;
  const dt = FRAME.rawDt;

  UIKIT.beginScreen('menu');
  drawScreenBackdrop(c, { veil: 0.6, horizon: 0.66, gridAlpha: 0.17 });

  /* ---------------------------------------------------------- titre ----- */
  const titleTop = Math.max(CANVAS_HEIGHT * 0.13, 46 * S);
  let titleSize = clamp(CANVAS_WIDTH * 0.082, 40, 104) * (CANVAS_HEIGHT < 560 ? 0.78 : 1);
  // ajustement pour ne jamais déborder
  while (titleSize > 26 &&
         UIKIT.vectorWidth('GALABOB', titleSize, { tracking: titleSize * 0.34 }) > CANVAS_WIDTH * 0.78) {
    titleSize *= 0.94;
  }

  const inTitle = UIKIT.enter(0.02, 0.55);
  const breathe = 1 + UIKIT.osc(0.22, 0.012);
  const tSize = titleSize * breathe * clamp(inTitle, 0, 1.06);

  UIKIT.vectorTitle(c, 'GALABOB', cx, titleTop, tSize, PALETTE.ui.text, {
    align: 'center',
    slant: 0.08,
    tracking: tSize * 0.34,
    width: Math.max(1.3, tSize * 0.05),
    alpha: clamp(inTitle, 0, 1),
    glitch: 0.04
  });

  // sous-titre + filets
  const subY = titleTop + tSize + 30 * S;

  // Reflet au sol : écrasé verticalement, presque éteint.
  // Il est DÉTOURÉ à la bande libre entre le bas du titre et le sous-titre.
  // Sans ce détourage, le reflet (52 px de haut) traversait le sous-titre et
  // ses lettres inversées se lisaient comme des octogones flottants — un
  // artefact qu'on prenait pour une rémanence de rendu.
  const refTop = titleTop + tSize + 4 * S;
  const refBottom = subY - 14 * S;
  if (refBottom > refTop + 2) {
    c.save();
    c.beginPath();
    c.rect(0, refTop, CANVAS_WIDTH, refBottom - refTop);
    c.clip();
    c.translate(0, (titleTop + tSize) * 1.5 + 8 * S);
    c.scale(1, -0.5);
    UIKIT.vector(c, 'GALABOB', cx, titleTop, tSize, PALETTE.ui.accent, {
      align: 'center', slant: 0.08, tracking: tSize * 0.34,
      width: Math.max(1, tSize * 0.045), alpha: 0.16 * clamp(inTitle, 0, 1), halo: false, passes: 2
    });
    c.restore();
  }

  const inSub = UIKIT.enter(0.18, 0.5);
  const subTxt = 'ASSAUT VECTORIEL · ÉDITION NÉON';
  const subW = UIKIT.label(c, subTxt, cx, subY, PALETTE.ui.accent, {
    size: 12 * S, tracking: 6 * S, align: 'center', alpha: 0.75 * clamp(inSub, 0, 1)
  });
  const ruleW = (CANVAS_WIDTH * 0.3) * clamp(inSub, 0, 1);
  const rule = new Path2D();
  rule.moveTo(cx - subW / 2 - 18 * S - ruleW, subY - 4 * S);
  rule.lineTo(cx - subW / 2 - 18 * S, subY - 4 * S);
  rule.moveTo(cx + subW / 2 + 18 * S, subY - 4 * S);
  rule.lineTo(cx + subW / 2 + 18 * S + ruleW, subY - 4 * S);
  NEON.custom(c, rule, 'player', 1.2, { alpha: 0.32 * clamp(inSub, 0, 1), cap: 'butt' });

  /* ---------------------------------------------- meilleur score -------- */
  MENU_STATE.bestShown = rollTowards(MENU_STATE.bestShown, Number(highScore) || 0, dt, 0.0009);
  const bestY = CANVAS_HEIGHT / 2 - 78;
  const inBest = clamp(UIKIT.enter(0.3, 0.5), 0, 1);
  UIKIT.label(c, 'MEILLEUR SCORE', cx, bestY - 16, PALETTE.ui.textDim, {
    size: 11 * S, tracking: 5 * S, align: 'center', alpha: 0.75 * inBest
  });
  UIKIT.vector(c, String(Math.round(MENU_STATE.bestShown)), cx, bestY, 26 * S, PALETTE.ui.combo, {
    align: 'center', tracking: 7 * S, width: 2 * S, alpha: inBest
  });

  /* ------------------------------------------------------ entrées ------- */
  const bw = clamp(CANVAS_WIDTH * 0.26, 220, 340);
  const bh = 46;
  const playY = CANVAS_HEIGHT / 2 - 6;
  const setY = CANVAS_HEIGHT / 2 + 52;

  const inPlay = clamp(UIKIT.enter(0.4, 0.5), 0, 1);
  const inSet = clamp(UIKIT.enter(0.48, 0.5), 0, 1);

  UIKIT.button(c, {
    id: 'menu.play',
    x: cx - bw / 2 + (1 - inPlay) * 40, y: playY, w: bw, h: bh,
    label: 'JOUER', hint: 'ENTRÉE', hintW: 62,
    primary: true, alpha: inPlay,
    color: PALETTE.ui.accent,
    action: function () { if (typeof initGame === 'function') initGame(); }
  });

  UIKIT.button(c, {
    id: 'menu.settings',
    x: cx - bw / 2 - (1 - inSet) * 40, y: setY, w: bw, h: bh - 6,
    label: 'PARAMÈTRES', hint: 'S', hintW: 26,
    alpha: inSet, size: 15,
    color: PALETTE.ui.accentAlt,
    action: function () { gameState = 'settings'; }
  });

  /* -------------------------------------------------------- audio ------- */
  // Rectangle historique lu par js/core/input.js : NE PAS DÉPLACER.
  const sb = UIKIT.hitRects.soundButton();
  let controlsY;

  if (!uiAudioReady()) {
    UIKIT.label(c, 'ANALYSE DES PISTES AUDIO…', cx, sb.y + 26, PALETTE.ui.textWarm, {
      size: 13, tracking: 3.5, align: 'center', alpha: 0.6 + 0.4 * Math.abs(Math.sin(FRAME.realTime * 2))
    });
    controlsY = sb.y + 62;
  } else if (!uiSoundEnabled()) {
    UIKIT.label(c, 'SON DÉSACTIVÉ — CLIQUEZ POUR L’ACTIVER', cx, sb.y - 16,
      PALETTE.ui.textWarm, { size: 11, tracking: 3.2, align: 'center', alpha: 0.75 });

    UIKIT.button(c, {
      id: 'menu.sound',
      x: sb.x, y: sb.y, w: sb.width, h: sb.height,
      label: 'ACTIVER LE SON', size: 12.5, labelDx: 11,
      color: PALETTE.ui.good,
      legacy: true               // l'action reste gérée par js/core/input.js
    });

    // petite icône de haut-parleur, calée à gauche du libellé
    const ic = new Path2D();
    const ix = sb.x + 26, iy = sb.y + sb.height / 2;
    ic.moveTo(ix - 5, iy - 2.5); ic.lineTo(ix - 1.5, iy - 2.5); ic.lineTo(ix + 2.5, iy - 6.5);
    ic.lineTo(ix + 2.5, iy + 6.5); ic.lineTo(ix - 1.5, iy + 2.5); ic.lineTo(ix - 5, iy + 2.5);
    ic.closePath();
    ic.moveTo(ix + 6, iy - 3.5); ic.lineTo(ix + 8, iy); ic.lineTo(ix + 6, iy + 3.5);
    NEON.custom(c, ic, PALETTE.ui.good, 1.3, { alpha: 0.65 + 0.35 * Math.sin(FRAME.realTime * 4) });

    controlsY = sb.y + sb.height + 42;
  } else {
    const on = new Path2D();
    const ix = cx - 58, iy = sb.y + 8;
    on.moveTo(ix - 5, iy - 3); on.lineTo(ix - 1, iy - 3); on.lineTo(ix + 4, iy - 7);
    on.lineTo(ix + 4, iy + 7); on.lineTo(ix - 1, iy + 3); on.lineTo(ix - 5, iy + 3);
    on.closePath();
    NEON.custom(c, on, PALETTE.ui.good, 1.3, { alpha: 0.75 });
    UIKIT.label(c, 'SON ACTIF', cx + 6, sb.y + 13, PALETTE.ui.good, {
      size: 12, tracking: 4, align: 'center', alpha: 0.8
    });
    controlsY = sb.y + 46;
  }

  /* ------------------------------------------------------ contrôles ----- */
  drawControlsPanel(c, cx, controlsY, S);

  UIKIT.endScreen();
}

/** Rappel des commandes. Se réduit automatiquement si la place manque. */
function drawControlsPanel(c, cx, y, S) {
  const room = CANVAS_HEIGHT - y;
  const inC = clamp(UIKIT.enter(0.6, 0.6), 0, 1);
  if (inC <= 0.01 || room < 46) return;

  const compact = room < 150 || CANVAS_HEIGHT < 700;

  const rows = compact
    ? [['← →', 'PILOTER'], ['ESPACE', 'TIRER'], ['P', 'PAUSE']]
    : [
        ['← →', 'PILOTER'], ['ESPACE', 'TIRER'],
        ['P', 'PAUSE'], ['ESC', 'QUITTER'],
        ['A', 'AUDIO'], ['M', 'MUSIQUE'],
        ['N', 'NARRATION'], ['F3', 'STATS']
      ];

  const cols = compact ? rows.length : 2;
  const lines = Math.ceil(rows.length / cols);
  const lineH = 26 * S;
  const colW = compact ? clamp(CANVAS_WIDTH / (cols + 1), 110, 190) : 190 * S;
  const totalW = cols * colW;
  const x0 = cx - totalW / 2;

  UIKIT.label(c, 'COMMANDES', cx, y, PALETTE.ui.textDim, {
    size: 10 * S, tracking: 5 * S, align: 'center', alpha: 0.6 * inC
  });

  const top = y + 14 * S;
  for (let i = 0; i < rows.length; i++) {
    const col = compact ? i : (i % cols);
    const line = compact ? 0 : Math.floor(i / cols);
    if (top + line * lineH > CANVAS_HEIGHT - 18) break;
    const rx = x0 + col * colW;
    const ry = top + line * lineH;
    const kw = UIKIT.keycap(c, rx, ry, rows[i][0], {
      size: 11 * S, height: 19 * S, color: PALETTE.ui.accent, alpha: 0.55 * inC
    });
    UIKIT.label(c, rows[i][1], rx + kw + 9 * S, ry + 14 * S, PALETTE.ui.textDim, {
      size: 11 * S, tracking: 2.4 * S, alpha: 0.7 * inC
    });
  }
  void lines;
}

/* =============================================================================
 *  MENU PAUSE — voile DISCRET : la partie gelée doit rester lisible dessous
 * ========================================================================== */
function drawPauseMenu() {
  const c = ctx;
  const S = UIKIT.scale();
  const cx = CANVAS_WIDTH / 2;

  UIKIT.beginScreen('pause');

  UIKIT.veil(c, 0.5);
  UIKIT.scanlines(c, 0.14);

  // balayage lumineux qui descend lentement — signal « figé, sous contrôle »
  const sweepY = (FRAME.realTime * 90) % (CANVAS_HEIGHT + 200) - 100;
  NEON.line(c, 0, sweepY, CANVAS_WIDTH, sweepY, 'player', 1.2,
    { alpha: 0.1, halo: false, passes: 2, cap: 'butt' });

  const inP = clamp(UIKIT.enter(0, 0.35), 0, 1.05);
  const titleY = CANVAS_HEIGHT / 2 - 118 * S;
  const size = clamp(CANVAS_WIDTH * 0.05, 34, 68) * S;

  UIKIT.vectorTitle(c, 'PAUSE', cx, titleY, size * inP, PALETTE.ui.text, {
    align: 'center', tracking: size * 0.36, slant: 0.05,
    width: Math.max(1.3, size * 0.055), alpha: clamp(inP, 0, 1)
  });

  // Cadre englobant
  const boxW = clamp(CANVAS_WIDTH * 0.36, 280, 460);
  const boxH = 214 * S;
  UIKIT.bracketFrame(c, cx - boxW / 2, titleY - 26 * S, boxW, boxH, PALETTE.ui.accent, {
    corner: 26 * S, width: 1.4, alpha: 0.32 * inP
  });

  UIKIT.label(c, 'SCORE', cx, titleY + size + 26 * S, PALETTE.ui.textDim, {
    size: 11 * S, tracking: 5 * S, align: 'center', alpha: 0.7 * inP
  });
  UIKIT.vector(c, String(score), cx, titleY + size + 34 * S, 24 * S, PALETTE.ui.accent, {
    align: 'center', tracking: 6 * S, width: 1.8 * S, alpha: inP
  });

  const bw = clamp(CANVAS_WIDTH * 0.2, 180, 250);
  const by = titleY + size + 84 * S;

  UIKIT.button(c, {
    id: 'pause.resume',
    x: cx - bw / 2, y: by, w: bw, h: 40,
    label: 'REPRENDRE', hint: 'P', hintW: 24, size: 15,
    primary: true, color: PALETTE.ui.accent,
    action: function () { isPaused = false; if (typeof autoPaused !== 'undefined') autoPaused = false; }
  });

  UIKIT.button(c, {
    id: 'pause.quit',
    x: cx - bw / 2, y: by + 50, w: bw, h: 36,
    label: 'QUITTER', hint: 'ESC', hintW: 34, size: 13,
    color: PALETTE.ui.warn,
    action: function () { gameState = 'menu'; isPaused = false; }
  });

  UIKIT.endScreen();
}

/* =============================================================================
 *  ÉCRAN DE FIN DE PARTIE
 * ========================================================================== */
function drawGameOverScreen() {
  const c = ctx;
  const S = UIKIT.scale();
  const cx = CANVAS_WIDTH / 2;
  const dt = FRAME.rawDt;

  // beginScreen renvoie true quand l'écran vient d'apparaître : c'est là qu'on
  // remet le compteur à zéro pour le regarder remonter.
  if (UIKIT.beginScreen('gameover')) MENU_STATE.finalShown = 0;
  drawScreenBackdrop(c, { veil: 0.72, horizon: 0.66, gridColor: PALETTE.ui.warn, gridAlpha: 0.13, scan: 0.2 });

  const age = UIKIT.screenAge();
  const titleTop = Math.max(CANVAS_HEIGHT * 0.16, 44 * S);
  let size = clamp(CANVAS_WIDTH * 0.062, 32, 84);
  while (size > 22 &&
         UIKIT.vectorWidth('GAME OVER', size, { tracking: size * 0.34 }) > CANVAS_WIDTH * 0.8) size *= 0.94;

  const inT = clamp(UIKIT.enter(0, 0.5), 0, 1.08);
  UIKIT.vectorTitle(c, 'GAME OVER', cx, titleTop, size * inT, PALETTE.ui.text, {
    align: 'center', tracking: size * 0.34, slant: 0.06,
    width: Math.max(1.3, size * 0.052),
    altColor: PALETTE.ui.warn, altColor2: PALETTE.ui.accentAlt,
    alpha: clamp(inT, 0, 1),
    glitch: age < 2.2 ? 0.35 : 0.06
  });

  /* ------------------------------------------------- score qui monte ---- */
  // Le total remonte de 0 : on regarde son propre score se compter.
  MENU_STATE.finalShown = rollTowards(MENU_STATE.finalShown, score, dt, 0.0025);
  const inS = clamp(UIKIT.enter(0.3, 0.5), 0, 1);
  const scoreY = CANVAS_HEIGHT / 2 - 4;

  UIKIT.label(c, 'SCORE FINAL', cx, scoreY - 46 * S, PALETTE.ui.textDim, {
    size: 11 * S, tracking: 5.5 * S, align: 'center', alpha: 0.8 * inS
  });
  UIKIT.vector(c, String(Math.round(MENU_STATE.finalShown)), cx, scoreY - 34 * S, 40 * S,
    PALETTE.ui.accent, { align: 'center', tracking: 10 * S, width: 2.6 * S, alpha: inS });

  // Stage atteint
  const stg = (typeof stageSystem !== 'undefined' && stageSystem) ? stageSystem.currentStage : 1;
  UIKIT.label(c, 'STAGE ' + stg + '  ·  MEILLEUR ' + (Number(highScore) || 0),
    cx, scoreY + 22 * S, PALETTE.ui.textDim, {
      size: 12 * S, tracking: 3.5 * S, align: 'center', alpha: 0.65 * inS
    });

  // Nouveau record
  if (score > 0 && score >= (Number(highScore) || 0)) {
    const flash = 0.55 + 0.45 * Math.sin(FRAME.realTime * 6);
    UIKIT.label(c, '▸ NOUVEAU RECORD ◂', cx, scoreY + 50 * S, PALETTE.ui.combo, {
      size: 15 * S, tracking: 5 * S, align: 'center', alpha: (0.5 + flash * 0.5) * inS, weight: '700'
    });
  }

  /* ----------------------------------------------------------- boutons -- */
  const bw = clamp(CANVAS_WIDTH * 0.24, 210, 320);
  const by = CANVAS_HEIGHT / 2 + 86 * S;

  UIKIT.button(c, {
    id: 'over.retry',
    x: cx - bw / 2, y: by, w: bw, h: 44,
    label: 'REJOUER', hint: 'ENTRÉE', hintW: 62, size: 16,
    primary: true, color: PALETTE.ui.accent,
    alpha: clamp(UIKIT.enter(0.5, 0.45), 0, 1),
    action: function () { if (typeof initGame === 'function') initGame(); }
  });

  UIKIT.button(c, {
    id: 'over.menu',
    x: cx - bw / 2, y: by + 54, w: bw, h: 36,
    label: 'MENU PRINCIPAL', hint: 'ESC', hintW: 34, size: 13,
    color: PALETTE.ui.accentAlt,
    alpha: clamp(UIKIT.enter(0.58, 0.45), 0, 1),
    action: function () { gameState = 'menu'; }
  });

  UIKIT.endScreen();
}

/* =============================================================================
 *  ÉCRAN DES PARAMÈTRES
 * ========================================================================== */
function drawSettingsMenu() {
  const c = ctx;
  const S = UIKIT.scale();
  const cx = CANVAS_WIDTH / 2;

  UIKIT.beginScreen('settings');
  drawScreenBackdrop(c, { veil: 0.68, horizon: 0.7, gridAlpha: 0.12 });

  const titleTop = Math.max(CANVAS_HEIGHT * 0.13, 40 * S);
  let size = clamp(CANVAS_WIDTH * 0.05, 28, 62);
  while (size > 20 &&
         UIKIT.vectorWidth('PARAMÈTRES', size, { tracking: size * 0.3 }) > CANVAS_WIDTH * 0.8) size *= 0.94;
  const inT = clamp(UIKIT.enter(0, 0.45), 0, 1.06);

  UIKIT.vectorTitle(c, 'PARAMÈTRES', cx, titleTop, size * inT, PALETTE.ui.text, {
    align: 'center', tracking: size * 0.34, slant: 0.05,
    width: Math.max(1.2, size * 0.055), alpha: clamp(inT, 0, 1)
  });

  /* --------------------------------------------------------- audio ------ */
  const vb = UIKIT.hitRects.volumeButton();

  // Le bouton des volumes est à une position IMPOSÉE (rectangle historique lu
  // par input.js) : le bloc audio se cale donc entre le bas du titre et lui,
  // et s'efface s'il n'y a pas la place — mieux vaut moins que du chevauchement.
  const titleBottom = titleTop + size + 12;
  const audioTop = Math.max(titleBottom + 24, vb.y - 124);
  const roomForMix = (vb.y - 18) - (audioTop + 14) >= 74;

  UIKIT.label(c, 'AUDIO', cx, audioTop, PALETTE.ui.textDim, {
    size: 11 * S, tracking: 6 * S, align: 'center', alpha: 0.7
  });

  // Niveaux actuels, en lecture seule : le réglage fin se fait dans le panneau
  // HTML (les curseurs natifs restent accessibles au clavier).
  const mixRows = [
    ['MUSIQUE', 'musicVolume', PALETTE.ui.accent],
    ['NARRATION', 'narrationVolume', PALETTE.ui.accentAlt],
    ['EFFETS', 'sfxVolume', PALETTE.ui.good]
  ];
  const barW = clamp(120 * S, 90, 170);
  const barX = cx - 44 * S;
  for (let i = 0; roomForMix && i < mixRows.length; i++) {
    const ry = audioTop + 22 + i * 24;
    const vol = (typeof audioConfig !== 'undefined' && audioConfig &&
                 typeof audioConfig[mixRows[i][1]] === 'number') ? audioConfig[mixRows[i][1]] : 0;
    const muted = !uiSoundEnabled();
    UIKIT.label(c, mixRows[i][0], barX - 12 * S, ry + 4, PALETTE.ui.textDim, {
      size: 9.5 * S, tracking: 2.4 * S, align: 'right', alpha: muted ? 0.3 : 0.65
    });
    UIKIT.bar(c, barX, ry, barW, 4, vol, mixRows[i][2], {
      alpha: muted ? 0.28 : 0.85, head: false
    });
    UIKIT.label(c, Math.round(vol * 100) + '%', barX + barW + 10 * S, ry + 4,
      mixRows[i][2], { size: 9.5 * S, tracking: 1 * S, alpha: muted ? 0.3 : 0.7, mono: true });
  }

  UIKIT.button(c, {
    id: 'set.volumes',
    x: vb.x, y: vb.y, w: vb.width, h: vb.height,
    label: 'RÉGLER LES VOLUMES', size: 13,
    color: PALETTE.ui.accent,
    legacy: true                 // action gérée par js/core/input.js
  });

  const soundTxt = uiSoundEnabled() ? 'SON ACTIF' : 'SON COUPÉ';
  UIKIT.label(c, soundTxt, cx, vb.y + vb.height + 22, uiSoundEnabled() ? PALETTE.ui.good : PALETTE.ui.warn, {
    size: 12, tracking: 4, align: 'center', alpha: 0.85
  });

  /* --------------------------------------------------------- rendu ------ */
  const bw = clamp(CANVAS_WIDTH * 0.26, 230, 340);
  const rowY = vb.y + vb.height + 48;
  const qualityNames = ['MINIMALE', 'SIMPLE', 'HAUTE', 'ULTRA'];
  const q = clamp(RENDER_CONFIG.quality | 0, 0, 3);

  UIKIT.button(c, {
    id: 'set.quality',
    x: cx - bw / 2, y: rowY, w: bw, h: 38,
    label: 'QUALITÉ : ' + qualityNames[q], size: 13,
    color: PALETTE.ui.accentAlt,
    action: function () {
      const next = (clamp(RENDER_CONFIG.quality | 0, 0, 3) + 3) % 4;   // 3→2→1→0→3
      NEON.setQuality(next);
      UIKIT.savePref('ui.quality', next);
    }
  });

  const shakeOn = !(typeof JUICE !== 'undefined' && JUICE.config) || JUICE.config.enabled !== false;
  UIKIT.button(c, {
    id: 'set.shake',
    x: cx - bw / 2, y: rowY + 46, w: bw, h: 38,
    label: 'SECOUSSES : ' + (shakeOn ? 'ACTIVÉES' : 'COUPÉES'), size: 13,
    color: shakeOn ? PALETTE.ui.good : PALETTE.ui.textDim,
    action: function () {
      if (typeof JUICE !== 'undefined' && JUICE.config) {
        JUICE.config.enabled = !JUICE.config.enabled;
        UIKIT.savePref('ui.shake', JUICE.config.enabled);
      }
    }
  });

  UIKIT.button(c, {
    id: 'set.debug',
    x: cx - bw / 2, y: rowY + 92, w: bw, h: 38,
    label: 'STATS : ' + (GAME_CONFIG.showDebugInfo ? 'VISIBLES' : 'MASQUÉES'),
    hint: 'F3', hintW: 32, size: 13,
    color: GAME_CONFIG.showDebugInfo ? PALETTE.ui.combo : PALETTE.ui.textDim,
    action: function () {
      GAME_CONFIG.showDebugInfo = !GAME_CONFIG.showDebugInfo;
      UIKIT.savePref('showDebugInfo', GAME_CONFIG.showDebugInfo);
    }
  });

  /* ------------------------------------------------------ raccourcis ---- */
  const hintY = rowY + 174;
  if (hintY < CANVAS_HEIGHT - 70) {
    const hints = [['M', 'CHANGER DE MUSIQUE'], ['N', 'DÉCLENCHER UNE NARRATION'], ['A', 'PANNEAU DES VOLUMES']];
    for (let i = 0; i < hints.length; i++) {
      const ry = hintY + i * 24 * S;
      if (ry > CANVAS_HEIGHT - 46) break;
      const kw = UIKIT.keycap(c, cx - 110 * S, ry - 13 * S, hints[i][0], {
        size: 11 * S, height: 18 * S, color: PALETTE.ui.accent, alpha: 0.5
      });
      UIKIT.label(c, hints[i][1], cx - 110 * S + kw + 10 * S, ry, PALETTE.ui.textDim, {
        size: 11 * S, tracking: 2.4 * S, alpha: 0.65
      });
    }
  }

  /* ------------------------------------------------------------ retour -- */
  UIKIT.button(c, {
    id: 'set.back',
    x: cx - 90, y: CANVAS_HEIGHT - 62, w: 180, h: 34,
    label: 'RETOUR', hint: 'ESC', hintW: 34, size: 13,
    color: PALETTE.ui.accent,
    action: function () { gameState = 'menu'; }
  });

  UIKIT.endScreen();
}

