/* =============================================================================
 *  galabob — NEON : moteur de rendu émissif + bloom + aberration chromatique
 * -----------------------------------------------------------------------------
 *  Canvas 2D pur, zéro dépendance.
 *
 *  PRINCIPE
 *  --------
 *  Le jeu ne dessine plus directement sur le canvas visible. Il dessine dans un
 *  buffer ÉMISSIF hors-écran. NEON recompose ensuite :
 *      fond noir  +  buffer net (1:1)  +  bloom (2 niveaux, additif)
 *                 +  aberration chromatique  +  vignette
 *
 *  Pour que les modules existants n'aient RIEN à changer, NEON.beginFrame()
 *  RÉAFFECTE la variable globale `ctx` vers le contexte émissif. Tout appel
 *  `ctx.xxx()` fait entre beginFrame() et endFrame() atterrit donc dans le
 *  buffer émissif et sera bloomé.
 *
 *  PIPELINE (implémenté dans game.js -> draw()) :
 *      NEON.beginFrame();   // vide les buffers, branche `ctx`, applique la caméra
 *      ...tout le dessin de la scène...
 *      NEON.endFrame();     // débranche `ctx`, replie les traînées
 *      NEON.composite();    // bloom + aberration -> canvas visible
 *
 *  TRAÎNÉES
 *  --------
 *  `NEON.trail` est un second contexte, persistant, effacé progressivement.
 *  Un module qui veut une traînée de mouvement dessine la MÊME forme dedans :
 *      NEON.line(NEON.trail, x0, y0, x1, y1, 'bullet.player', 2);
 *  Le buffer est replié dans la scène à endFrame(). Ne PAS y dessiner de HUD.
 *
 *  HELPERS DE TRACÉ (toujours ctx en 1er argument)
 *  -----------------------------------------------
 *      NEON.line(c, x1,y1, x2,y2, color, width, opts)
 *      NEON.polyline(c, pts, color, width, opts)          pts = [{x,y}…] ou [x,y,x,y…]
 *      NEON.shape(c, pts, color, width, opts)             polygone fermé, opts.fill
 *      NEON.rect(c, x,y,w,h, color, width, opts)
 *      NEON.circle(c, x,y,r, color, width, opts)
 *      NEON.dot(c, x,y,r, color, opts)                    point lumineux plein
 *      NEON.beam(c, x,y,w,h, color, opts)                 capsule (projectiles)
 *      NEON.ring(c, x,y,r, thickness, color, opts)        onde de choc
 *      NEON.text(c, str, x,y, color, opts)
 *      NEON.custom(c, path, color, width, opts)           Path2D ou fn(Path2D)
 *      NEON.fill(c, path, color, opts)                    remplissage doux
 *
 *  `color` accepte : une clé PALETTE ('player', 'enemy.normal', 'normal'…),
 *  un triplet PALETTE, ou une couleur CSS brute.
 *
 *  `opts` communes : { alpha, glowScale, composite, cap, join, dash,
 *                      coreWidth, halo (bool), passes (1..4) }
 * ========================================================================== */

const NEON = (function () {
  'use strict';

  const FALLBACK = { core: '#ffffff', glow: '#8fb8d8', burst: '#8fb8d8' };

  const S = {
    ready: false,
    mainCanvas: null,
    mainCtx: null,
    dpr: 1,
    cssW: 0, cssH: 0,
    pxW: 0, pxH: 0,
    scene: null, sceneCtx: null,
    trailCv: null, trailCtx: null,
    purgeBand: 0,                 // bande courante de la purge roulante
    bloomA: null, bloomACtx: null,
    bloomB: null, bloomBCtx: null,
    tintR: null, tintRCtx: null,
    tintC: null, tintCCtx: null,
    fbA: null, fbACtx: null,      // repli si ctx.filter absent
    bound: false,
    boundCtx: null,
    prevCtx: null,
    filterOK: false,
    slowFrames: 0,
    vignetteGrad: null,
    vignetteKey: ''
  };

  /* ---------------------------------------------------------------- outils */

  function mkCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function detectFilterSupport() {
    try {
      const c = document.createElement('canvas').getContext('2d');
      if (!c || typeof c.filter === 'undefined') return false;
      c.filter = 'blur(2px)';
      return c.filter === 'blur(2px)';
    } catch (e) { return false; }
  }

  function resolve(color) {
    if (!color) return FALLBACK;
    if (typeof PALETTE !== 'undefined' && PALETTE) return PALETTE.get(color);
    if (typeof color === 'object') return { core: color.core || '#fff', glow: color.glow || '#fff', burst: color.burst || '#fff' };
    return { core: '#ffffff', glow: color, burst: color };
  }

  /* ------------------------------------------------------- initialisation */

  function init(mainCanvas, mainContext) {
    S.mainCanvas = mainCanvas || (typeof canvas !== 'undefined' ? canvas : null);
    S.mainCtx = mainContext || (typeof ctx !== 'undefined' ? ctx : null);
    if (!S.mainCanvas || !S.mainCtx) {
      console.warn('NEON.init : canvas principal introuvable, bloom désactivé.');
      RENDER_CONFIG.bloom = false;
      return false;
    }
    S.filterOK = detectFilterSupport();
    if (!S.filterOK) {
      console.info("NEON : ctx.filter indisponible, repli sur un flou par ré-échantillonnage.");
    }
    resize(CANVAS_WIDTH, CANVAS_HEIGHT, DPR);
    S.ready = true;
    return true;
  }

  /** (Ré)alloue tous les buffers. Appelé uniquement au resize, jamais par frame. */
  function resize(cssW, cssH, dpr) {
    if (!S.mainCanvas) {
      S.mainCanvas = (typeof canvas !== 'undefined' ? canvas : null);
      S.mainCtx = (typeof ctx !== 'undefined' ? ctx : null);
      if (!S.mainCanvas || !S.mainCtx) return;
    }

    S.cssW = Math.max(1, cssW | 0);
    S.cssH = Math.max(1, cssH | 0);
    S.dpr = dpr || 1;
    S.pxW = Math.max(1, Math.round(S.cssW * S.dpr));
    S.pxH = Math.max(1, Math.round(S.cssH * S.dpr));

    const halfW = Math.max(1, Math.round(S.pxW / 2)),  halfH = Math.max(1, Math.round(S.pxH / 2));
    const qW    = Math.max(1, Math.round(S.pxW / 4)),  qH    = Math.max(1, Math.round(S.pxH / 4));
    const eW    = Math.max(1, Math.round(S.pxW / 8)),  eH    = Math.max(1, Math.round(S.pxH / 8));
    const sW    = Math.max(1, Math.round(S.pxW / 16)), sH    = Math.max(1, Math.round(S.pxH / 16));

    // Scène émissive : pleine résolution physique, repère CSS px.
    S.scene = mkCanvas(S.pxW, S.pxH);
    S.sceneCtx = S.scene.getContext('2d');
    S.sceneCtx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    S.sceneCtx.imageSmoothingEnabled = true;

    // Traînées : demi-résolution (le flou masque la perte), repère CSS px.
    S.trailCv = mkCanvas(halfW, halfH);
    S.trailCtx = S.trailCv.getContext('2d');
    S.trailCtx.setTransform(halfW / S.cssW, 0, 0, halfH / S.cssH, 0, 0);
    S.trailCtx.imageSmoothingEnabled = true;

    S.bloomA = mkCanvas(qW, qH);   S.bloomACtx = S.bloomA.getContext('2d');
    S.bloomB = mkCanvas(eW, eH);   S.bloomBCtx = S.bloomB.getContext('2d');
    S.tintR  = mkCanvas(qW, qH);   S.tintRCtx  = S.tintR.getContext('2d');
    S.tintC  = mkCanvas(qW, qH);   S.tintCCtx  = S.tintC.getContext('2d');
    S.fbA    = mkCanvas(sW, sH);   S.fbACtx    = S.fbA.getContext('2d');

    [S.bloomACtx, S.bloomBCtx, S.tintRCtx, S.tintCCtx, S.fbACtx].forEach(function (c) {
      c.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in c) c.imageSmoothingQuality = 'high';
    });

    S.vignetteGrad = null;
    S.vignetteKey = '';

    api.scene = S.sceneCtx;
    api.trail = S.trailCtx;
    api.mainCtx = S.mainCtx;
  }

  /* ------------------------------------------------------ cycle de frame */

  function bloomOn() {
    return !!(RENDER_CONFIG.bloom && RENDER_CONFIG.quality > 0 && S.ready && S.sceneCtx);
  }

  /** Vide/atténue les buffers, branche `ctx` sur la scène émissive, pose la caméra.
   *  @returns {CanvasRenderingContext2D} le contexte sur lequel dessiner */
  function beginFrame() {
    const useBloom = bloomOn();

    if (useBloom) {
      // Traînées : on atténue au lieu d'effacer (persistance indépendante du fps).
      //
      //  LE PLANCHER 8 BITS, ET COMMENT ON S'EN AFFRANCHIT.
      //  L'atténuation est MULTIPLICATIVE sur un alpha stocké sur 8 bits
      //  prémultipliés : chaque frame ARRONDIT le résultat. À trailFade = 0.88,
      //  round(4 × 0.88) = 4 indéfiniment — mesuré gelé après 600 frames. Les
      //  alphas faibles se figeaient donc sur tout l'écran, d'où un voile
      //  permanent et des fantômes brûlés dans le menu. C'est ce qui avait
      //  imposé un trailFade de 0.74, au prix de traînées très courtes.
      //
      //  On casse l'arrondi par une PURGE ROULANTE : chaque frame, une seule
      //  bande du buffer reçoit une atténuation bien plus forte. Un pixel voit
      //  donc `trailPurgeBands - 1` frames douces puis une frame agressive, ce
      //  qui le fait descendre jusqu'à 0 au lieu de se figer. Le découpage en
      //  bandes est ce qui rend l'opération invisible : sans lui, tout l'écran
      //  s'assombrirait d'un coup à intervalle régulier (scintillement à 6 Hz).
      //  Mesuré : plancher 0/255, traînée 20 frames (contre 8 auparavant).
      if (RENDER_CONFIG.trails && !S.trailFlush) {
        const dtN = Math.max(0.0001, FRAME.rawDt) * 60;
        const t = S.trailCtx;
        const W = S.trailCv.width, H = S.trailCv.height;
        t.save();
        t.setTransform(1, 0, 0, 1, 0, 0);
        t.globalCompositeOperation = 'destination-out';

        // 1) atténuation douce, sur tout le buffer
        const keep = Math.pow(clampNum(RENDER_CONFIG.trailFade, 0, 0.985), dtN);
        t.fillStyle = 'rgba(0,0,0,' + (1 - keep) + ')';
        t.fillRect(0, 0, W, H);

        // 2) purge roulante, sur une seule bande
        const bands = Math.max(2, RENDER_CONFIG.trailPurgeBands | 0);
        const purge = Math.pow(clampNum(RENDER_CONFIG.trailPurge, 0.05, 0.95), dtN);
        S.purgeBand = (S.purgeBand + 1) % bands;
        const y0 = Math.floor(S.purgeBand * H / bands);
        const y1 = Math.ceil((S.purgeBand + 1) * H / bands);
        t.fillStyle = 'rgba(0,0,0,' + (1 - purge) + ')';
        t.fillRect(0, y0, W, y1 - y0);

        t.restore();
      } else if (RENDER_CONFIG.trails && S.trailFlush) {
        // Purge demandée (changement d'écran, nouvelle partie, transition) :
        // aucune traînée ne doit survivre d'un écran à l'autre.
        S.trailFlush = false;
        S.trailCtx.save();
        S.trailCtx.setTransform(1, 0, 0, 1, 0, 0);
        S.trailCtx.clearRect(0, 0, S.trailCv.width, S.trailCv.height);
        S.trailCtx.restore();
      } else {
        S.trailCtx.save();
        S.trailCtx.setTransform(1, 0, 0, 1, 0, 0);
        S.trailCtx.clearRect(0, 0, S.trailCv.width, S.trailCv.height);
        S.trailCtx.restore();
      }

      const c = S.sceneCtx;
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, S.scene.width, S.scene.height);
      c.restore();

      // brancher la globale `ctx`
      S.prevCtx = ctx;
      ctx = c;
      S.bound = true;
      S.boundCtx = c;

      c.save();
      JUICE.applyCamera(c);
      return c;

    } else {
      // Sans bloom : on dessine directement sur le canvas visible.
      const c = S.mainCtx || ctx;
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = (typeof PALETTE !== 'undefined' ? PALETTE.bg.base : '#05060f');
      c.fillRect(0, 0, S.pxW || c.canvas.width, S.pxH || c.canvas.height);
      c.restore();

      S.prevCtx = ctx;
      ctx = c;
      S.bound = true;
      S.boundCtx = c;

      c.save();
      JUICE.applyCamera(c);
      return c;
    }
  }

  /** Referme la passe scène : replie les traînées, retire la caméra, débranche `ctx`. */
  function endFrame() {
    if (!S.bound) return;
    const c = S.boundCtx;

    // Traînées repliées dans la scène AVANT de retirer la caméra, pour qu'elles
    // suivent le même décalage que le reste.
    if (bloomOn() && RENDER_CONFIG.trails && S.trailCv) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = 1;
      c.drawImage(S.trailCv, 0, 0, S.cssW, S.cssH);
      c.restore();
    }

    c.restore();          // annule JUICE.applyCamera
    ctx = S.prevCtx;      // débranche la globale
    S.bound = false;
    S.boundCtx = null;
  }

  /* ------------------------------------------------------------- le bloom */

  function clampNum(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /** Réduit `src` dans `dstCtx` ET le floute, en une seule passe.
   *  `src` et `dstCtx.canvas` sont toujours deux canvas distincts. */
  function downBlur(dstCtx, src, blurPx) {
    const w = dstCtx.canvas.width, h = dstCtx.canvas.height;
    dstCtx.save();
    dstCtx.setTransform(1, 0, 0, 1, 0, 0);
    dstCtx.globalAlpha = 1;

    if (S.filterOK && blurPx > 0) {
      dstCtx.globalCompositeOperation = 'copy';
      dstCtx.filter = 'blur(' + blurPx + 'px)';
      dstCtx.drawImage(src, 0, 0, w, h);
      dstCtx.filter = 'none';
    } else {
      // Repli : downsample agressif via un buffer minuscule puis upsample —
      // le filtrage bilinéaire du navigateur fait office de flou.
      const f = S.fbACtx, fw = S.fbA.width, fh = S.fbA.height;
      f.save();
      f.setTransform(1, 0, 0, 1, 0, 0);
      f.globalCompositeOperation = 'copy';
      f.globalAlpha = 1;
      f.drawImage(src, 0, 0, fw, fh);
      f.globalCompositeOperation = 'source-over';
      f.restore();

      dstCtx.globalCompositeOperation = 'copy';
      dstCtx.drawImage(S.fbA, 0, 0, w, h);
      dstCtx.globalCompositeOperation = 'lighter';
      dstCtx.globalAlpha = 0.45;
      dstCtx.drawImage(S.fbA, -1.5, 0, w, h);
      dstCtx.drawImage(S.fbA, 1.5, 0, w, h);
      dstCtx.drawImage(S.fbA, 0, -1.5, w, h);
      dstCtx.drawImage(S.fbA, 0, 1.5, w, h);
    }

    dstCtx.globalCompositeOperation = 'source-over';
    dstCtx.restore();
  }

  /** Copie teintée de `src` dans `dstCtx`, en conservant l'alpha source. */
  function tintInto(dstCtx, src, cssColor) {
    const w = dstCtx.canvas.width, h = dstCtx.canvas.height;
    dstCtx.save();
    dstCtx.setTransform(1, 0, 0, 1, 0, 0);
    dstCtx.globalAlpha = 1;
    dstCtx.globalCompositeOperation = 'copy';
    dstCtx.drawImage(src, 0, 0, w, h);
    dstCtx.globalCompositeOperation = 'multiply';
    dstCtx.fillStyle = cssColor;
    dstCtx.fillRect(0, 0, w, h);
    dstCtx.globalCompositeOperation = 'destination-in';  // restaure l'alpha d'origine
    dstCtx.drawImage(src, 0, 0, w, h);
    dstCtx.globalCompositeOperation = 'source-over';
    dstCtx.restore();
  }

  function getVignette(m) {
    const key = S.pxW + 'x' + S.pxH + ':' + RENDER_CONFIG.vignette;
    if (S.vignetteGrad && S.vignetteKey === key) return S.vignetteGrad;
    const cx = S.pxW / 2, cy = S.pxH / 2;
    const r = Math.hypot(cx, cy);
    const g = m.createRadialGradient(cx, cy, r * 0.42, cx, cy, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + clampNum(RENDER_CONFIG.vignette, 0, 1) + ')');
    S.vignetteGrad = g;
    S.vignetteKey = key;
    return g;
  }

  /** Recompose la scène sur le canvas visible : net + bloom + aberration. */
  function composite() {
    if (!bloomOn()) return;

    const m = S.mainCtx;
    const q = RENDER_CONFIG.quality;
    const gain = clampNum(RENDER_CONFIG.bloomIntensity, 0, 2);

    // 1) réductions + flous successifs (scène -> 1/4 -> 1/8)
    downBlur(S.bloomACtx, S.scene, RENDER_CONFIG.bloomBlurA);
    const useB = q >= 2;
    if (useB) downBlur(S.bloomBCtx, S.bloomA, RENDER_CONFIG.bloomBlurB);

    // 2) composition sur le canvas visible
    m.save();
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1;
    m.fillStyle = (typeof PALETTE !== 'undefined' ? PALETTE.bg.base : '#05060f');
    m.fillRect(0, 0, S.pxW, S.pxH);

    // couche nette
    m.drawImage(S.scene, 0, 0, S.pxW, S.pxH);

    // couches de halo, additives
    m.globalCompositeOperation = 'lighter';
    m.globalAlpha = clampNum(gain * RENDER_CONFIG.bloomWeightA, 0, 1);
    m.drawImage(S.bloomA, 0, 0, S.pxW, S.pxH);
    if (useB) {
      m.globalAlpha = clampNum(gain * RENDER_CONFIG.bloomWeightB, 0, 1);
      m.drawImage(S.bloomB, 0, 0, S.pxW, S.pxH);
    }

    // 3) aberration chromatique : deux copies teintées du halo, décalées
    const ab = RENDER_CONFIG.aberration;
    if (q >= 3 && ab > 0.05) {
      tintInto(S.tintRCtx, S.bloomA, '#ff2a2a');
      tintInto(S.tintCCtx, S.bloomA, '#2affff');
      const d = ab * S.dpr;
      m.globalAlpha = clampNum(gain * 0.34, 0, 1);
      m.drawImage(S.tintR, -d, 0, S.pxW, S.pxH);
      m.drawImage(S.tintC, d, 0, S.pxW, S.pxH);
    }

    // 4) vignette
    m.globalCompositeOperation = 'source-over';
    m.globalAlpha = 1;
    if (RENDER_CONFIG.vignette > 0.01) {
      m.fillStyle = getVignette(m);
      m.fillRect(0, 0, S.pxW, S.pxH);
    }

    m.restore();
    // rétablir le repère CSS px pour tout dessin ultérieur (flash, debug…)
    m.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  }

  /** Qualité adaptative : rétrograde si le framerate s'effondre durablement. */
  function tick() {
    if (!RENDER_CONFIG.autoQuality) return;
    // On n'évalue la qualité qu'en jeu et après le démarrage : le chargement
    // des ressources fait chuter le framerate sans que le rendu soit en cause.
    if (FRAME.frame < 600) return;
    if (typeof gameState !== 'undefined' && gameState !== 'playing') return;
    // SEUIL À 57, ET NON 45. Rater la synchronisation verticale d'une fraction
    // de milliseconde fait alterner l'affichage entre 60 et 30 fps : une frame
    // médiane à 17,9 ms pour un budget de 16,7 saccade DAVANTAGE qu'un 45 fps
    // stable. On dégrade donc bien avant l'effondrement, tant qu'il est encore
    // temps de repasser sous le budget.
    if (FRAME.fps < 57) {
      S.slowFrames++;
      if (S.slowFrames > 90) {
        S.slowFrames = 0;
        // On sacrifie D'ABORD la résolution. Le coût est proportionnel à la
        // surface, donc c'est le levier le plus efficace — et un pixel ratio
        // plus bas se remarque bien moins que la perte du bloom.
        const r = RENDER_CONFIG.maxPixelRatio;
        if (r > 1.25) {
          RENDER_CONFIG.maxPixelRatio = 1.25;
          if (typeof resizeCanvas === 'function') resizeCanvas();
          console.info('NEON : résolution ramenée à 1.25x');
        } else if (r > 1) {
          RENDER_CONFIG.maxPixelRatio = 1;
          if (typeof resizeCanvas === 'function') resizeCanvas();
          console.info('NEON : résolution ramenée à 1x');
        } else if (RENDER_CONFIG.quality > 0) {
          RENDER_CONFIG.quality--;
          console.info('NEON : qualité rétrogradée à', RENDER_CONFIG.quality);
        }
      }
    } else if (FRAME.fps > 59) {
      S.slowFrames = 0;   // un retour au plein régime annule le compteur
    }
  }

  /* ======================================================================
   *  HELPERS DE TRACÉ NÉON
   * ==================================================================== */

  function toPath(input) {
    if (input instanceof Path2D) return input;
    const p = new Path2D();
    if (typeof input === 'function') input(p);
    return p;
  }

  function ptsToPath(pts, closed) {
    const p = new Path2D();
    if (!pts || !pts.length) return p;
    if (typeof pts[0] === 'number') {
      p.moveTo(pts[0], pts[1]);
      for (let i = 2; i + 1 < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
    } else {
      p.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    }
    if (closed) p.closePath();
    return p;
  }

  /** Cœur du style néon : 4 passes additives, du halo large au noyau fin. */
  function strokeNeon(c, path, colorSpec, width, opts) {
    if (!c || !path) return;
    opts = opts || {};
    const col = resolve(colorSpec);
    const w = (width == null ? 2 : width);
    const alpha = (opts.alpha == null ? 1 : opts.alpha);
    if (alpha <= 0.002) return;
    const gs = (opts.glowScale == null ? 1 : opts.glowScale);
    const passes = opts.passes == null ? (RENDER_CONFIG.quality >= 2 ? 4 : 3) : opts.passes;

    c.save();
    c.globalCompositeOperation = opts.composite || 'lighter';
    c.lineCap = opts.cap || 'round';
    c.lineJoin = opts.join || 'round';
    if (opts.dash) c.setLineDash(opts.dash);
    if (opts.dashOffset) c.lineDashOffset = opts.dashOffset;

    c.strokeStyle = col.glow;

    if (passes >= 4 && opts.halo !== false) {
      c.globalAlpha = alpha * 0.16;
      c.lineWidth = w * 5.2 * gs;
      c.stroke(path);
    }
    if (passes >= 3 && opts.halo !== false) {
      c.globalAlpha = alpha * 0.34;
      c.lineWidth = w * 2.6 * gs;
      c.stroke(path);
    }
    c.globalAlpha = alpha * 0.92;
    c.lineWidth = Math.max(0.5, w * 1.15);
    c.stroke(path);

    c.strokeStyle = col.core;
    c.globalAlpha = alpha;
    c.lineWidth = Math.max(0.5, opts.coreWidth != null ? opts.coreWidth : w * 0.46);
    c.stroke(path);

    c.restore();
  }

  function fillNeon(c, path, colorSpec, opts) {
    if (!c || !path) return;
    opts = opts || {};
    const col = resolve(colorSpec);
    const alpha = (opts.alpha == null ? 1 : opts.alpha);
    if (alpha <= 0.002) return;
    c.save();
    c.globalCompositeOperation = opts.composite || 'lighter';
    c.globalAlpha = alpha * (opts.glowAlpha == null ? 0.28 : opts.glowAlpha);
    c.fillStyle = col.glow;
    c.fill(path);
    if (opts.core !== false) {
      c.globalAlpha = alpha * (opts.coreAlpha == null ? 0.55 : opts.coreAlpha);
      c.fillStyle = col.core;
      c.fill(path);
    }
    c.restore();
  }

  const api = {
    /* --- cycle --- */
    init: init,
    resize: resize,
    beginFrame: beginFrame,
    endFrame: endFrame,
    composite: composite,
    tick: tick,

    /* --- contextes exposés --- */
    scene: null,     // contexte émissif (== `ctx` entre beginFrame et endFrame)
    trail: null,     // contexte de traînées persistantes (demi-résolution)
    mainCtx: null,   // contexte du canvas visible (repère CSS px)

    /* --- réglages --- */
    setEnabled: function (on) { RENDER_CONFIG.bloom = !!on; },
    setIntensity: function (v) { RENDER_CONFIG.bloomIntensity = clampNum(v, 0, 2); },
    setAberration: function (px) { RENDER_CONFIG.aberration = Math.max(0, px); },
    setTrails: function (on, fade) {
      RENDER_CONFIG.trails = !!on;
      if (fade != null) RENDER_CONFIG.trailFade = clampNum(fade, 0, 0.75);
    },

    /** Purge la persistance à la frame suivante. À appeler à chaque fois qu'on
     *  CHANGE D'ÉCRAN (nouvelle partie, game over, retour menu, transition de
     *  stage) : sans ça les traînées de la partie précédente restent brûlées
     *  derrière le titre du menu. */
    clearTrail: function () { S.trailFlush = true; },
    setQuality: function (q) { RENDER_CONFIG.quality = clampNum(q | 0, 0, 3); },
    isEnabled: function () { return bloomOn(); },
    resolve: resolve,

    /* --- helpers de tracé --- */

    line: function (c, x1, y1, x2, y2, color, width, opts) {
      const p = new Path2D();
      p.moveTo(x1, y1); p.lineTo(x2, y2);
      strokeNeon(c, p, color, width, opts);
    },

    polyline: function (c, pts, color, width, opts) {
      strokeNeon(c, ptsToPath(pts, false), color, width, opts);
    },

    shape: function (c, pts, color, width, opts) {
      const p = ptsToPath(pts, true);
      opts = opts || {};
      if (opts.fill) fillNeon(c, p, color, { alpha: (opts.alpha == null ? 1 : opts.alpha) * (opts.fillAlpha == null ? 0.35 : opts.fillAlpha), composite: opts.composite });
      strokeNeon(c, p, color, width, opts);
    },

    rect: function (c, x, y, w, h, color, width, opts) {
      const p = new Path2D();
      p.rect(x, y, w, h);
      opts = opts || {};
      if (opts.fill) fillNeon(c, p, color, { alpha: (opts.alpha == null ? 1 : opts.alpha) * (opts.fillAlpha == null ? 0.3 : opts.fillAlpha) });
      strokeNeon(c, p, color, width, opts);
    },

    circle: function (c, x, y, r, color, width, opts) {
      const p = new Path2D();
      p.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
      opts = opts || {};
      if (opts.fill) fillNeon(c, p, color, { alpha: (opts.alpha == null ? 1 : opts.alpha) * (opts.fillAlpha == null ? 0.3 : opts.fillAlpha) });
      strokeNeon(c, p, color, width, opts);
    },

    /** Point lumineux plein : 3 disques additifs concentriques, aucun gradient
     *  alloué par frame. */
    dot: function (c, x, y, r, color, opts) {
      if (!c) return;
      opts = opts || {};
      const col = resolve(color);
      const a = (opts.alpha == null ? 1 : opts.alpha);
      if (a <= 0.002 || r <= 0) return;
      const gs = (opts.glowScale == null ? 1 : opts.glowScale);
      c.save();
      c.globalCompositeOperation = opts.composite || 'lighter';
      c.fillStyle = col.glow;
      c.globalAlpha = a * 0.18;
      c.beginPath(); c.arc(x, y, r * 3.1 * gs, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a * 0.40;
      c.beginPath(); c.arc(x, y, r * 1.7 * gs, 0, Math.PI * 2); c.fill();
      c.globalAlpha = a * 0.85;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.fillStyle = col.core;
      c.globalAlpha = a;
      c.beginPath(); c.arc(x, y, Math.max(0.4, r * 0.45), 0, Math.PI * 2); c.fill();
      c.restore();
    },

    /** Capsule lumineuse verticale ou horizontale — projectiles. */
    beam: function (c, x, y, w, h, color, opts) {
      const r = Math.min(w, h) / 2;
      const p = new Path2D();
      if (typeof p.roundRect === 'function') {
        p.roundRect(x, y, w, h, r);
      } else {
        p.moveTo(x + r, y);
        p.lineTo(x + w - r, y);
        p.arcTo(x + w, y, x + w, y + r, r);
        p.lineTo(x + w, y + h - r);
        p.arcTo(x + w, y + h, x + w - r, y + h, r);
        p.lineTo(x + r, y + h);
        p.arcTo(x, y + h, x, y + h - r, r);
        p.lineTo(x, y + r);
        p.arcTo(x, y, x + r, y, r);
        p.closePath();
      }
      opts = opts || {};
      fillNeon(c, p, color, { alpha: opts.alpha == null ? 1 : opts.alpha, glowAlpha: 0.5, coreAlpha: 0.95 });
      strokeNeon(c, p, color, opts.width == null ? Math.max(1, r * 0.8) : opts.width, opts);
    },

    /** Onde de choc : anneau lumineux d'épaisseur variable. */
    ring: function (c, x, y, r, thickness, color, opts) {
      const p = new Path2D();
      p.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
      strokeNeon(c, p, color, thickness == null ? 2 : thickness, opts);
    },

    /** Texte néon. opts : {size, font, weight, align, baseline, alpha, glowScale} */
    text: function (c, str, x, y, color, opts) {
      if (!c) return;
      opts = opts || {};
      const col = resolve(color);
      const size = opts.size == null ? 20 : opts.size;
      const fam = opts.font || (typeof PALETTE !== 'undefined' ? PALETTE.ui.font : 'Arial, sans-serif');
      const a = opts.alpha == null ? 1 : opts.alpha;
      if (a <= 0.002) return;
      c.save();
      c.font = (opts.weight || 'bold') + ' ' + size + 'px ' + fam;
      c.textAlign = opts.align || 'left';
      c.textBaseline = opts.baseline || 'alphabetic';
      c.globalCompositeOperation = opts.composite || 'lighter';
      c.shadowColor = col.glow;
      c.shadowBlur = size * 0.75 * (opts.glowScale == null ? 1 : opts.glowScale);
      c.fillStyle = col.glow;
      c.globalAlpha = a * 0.85;
      c.fillText(str, x, y);
      c.shadowBlur = size * 0.3;
      c.fillStyle = col.core;
      c.globalAlpha = a;
      c.fillText(str, x, y);
      c.shadowBlur = 0;
      c.restore();
      if (opts.measure) return c.measureText(str).width;
    },

    /** Tracé libre. `path` est un Path2D ou une fonction fn(path2d). */
    custom: function (c, path, color, width, opts) {
      strokeNeon(c, toPath(path), color, width, opts);
    },

    /** Remplissage doux. `path` est un Path2D ou une fonction fn(path2d). */
    fill: function (c, path, color, opts) {
      fillNeon(c, toPath(path), color, opts);
    },

    /** Accès bas niveau si un module veut composer lui-même. */
    strokePath: strokeNeon,
    fillPath: fillNeon,
    path: toPath,
    pointsToPath: ptsToPath
  };

  return api;
})();

window.NEON = NEON;
