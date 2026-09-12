/* =============================================================================
 *  galabob — HUD NÉON
 * -----------------------------------------------------------------------------
 *  Le HUD n'affiche pas seulement des valeurs : il RÉAGIT. Chaque chiffre qui
 *  change pulse, le score roule au lieu de sauter, la chaîne de combos possède
 *  son propre cadran qui se vide, et l'état du joueur (i-frames, respawn,
 *  dernière vie) est signalé à l'écran, là où l'œil se trouve déjà.
 *
 *  CONVENTIONS RESPECTÉES
 *  ----------------------
 *  • Animations de jeu : FRAME.dt / FRAME.time  (gelées en pause et en hitstop —
 *    c'est voulu : un hitstop qui fige AUSSI le HUD frappe bien plus fort).
 *  • Clignotements d'alerte : FRAME.realTime, pour rester lisibles même gelés.
 *  • Aucune division sans garde : dt peut valoir 0.
 *  • Tout le dessin passe par NEON.* + PALETTE + UIKIT (js/ui/menus.js).
 *
 *  Le HUD est peint DANS la passe émissive (`ctx` pointe sur le buffer néon) :
 *  il est donc bloomé comme le reste. drawDebugInfo(), lui, est appelé APRÈS la
 *  recomposition : il écrit directement sur le canvas visible, sans halo, ce
 *  qui est exactement ce qu'on veut d'un panneau de diagnostic discret.
 * ========================================================================== */

// Variables pour le HUD (globales historiques : game.js écrit `score`,
// saveHighScore() lit et écrit `highScore`).
let score = 0;
let highScore = Number(localStorage.getItem('highScore')) || 0;

/* -----------------------------------------------------------------------------
 *  ÉTAT D'ANIMATION DU HUD
 * -------------------------------------------------------------------------- */
const HUD_STATE = {
  scoreShown: 0,        // score affiché (roule vers `score`)
  scorePunch: 0,        // 0..1 — pulsation à chaque gain
  lastScore: 0,

  lastLives: -1,
  livesPunch: 0,

  lastStage: -1,
  stagePunch: 0,

  progressShown: 0,     // progression de stage lissée

  lastCombo: 0,
  comboShow: 0,         // 0..1 — apparition/disparition du cadran
  comboPunch: 0,
  comboBreak: 0,        // 0..1 — éclat rouge à la rupture de chaîne
  comboPeak: 0,

  alertText: '',
  alertSub: '',
  alertColor: '',
  alertLeft: 0,         // ms restantes
  alertDur: 1,

  weaponPunch: 0
};

/** Remise à zéro complète (nouvelle partie). Appelable depuis initGame(). */
function resetHUD() {
  HUD_STATE.scoreShown = 0;
  HUD_STATE.scorePunch = 0;
  HUD_STATE.lastScore = 0;
  HUD_STATE.lastLives = -1;
  HUD_STATE.livesPunch = 0;
  HUD_STATE.lastStage = -1;
  HUD_STATE.stagePunch = 0;
  HUD_STATE.progressShown = 0;
  HUD_STATE.lastCombo = 0;
  HUD_STATE.comboShow = 0;
  HUD_STATE.comboPunch = 0;
  HUD_STATE.comboBreak = 0;
  HUD_STATE.comboPeak = 0;
  HUD_STATE.alertLeft = 0;
  HUD_STATE.weaponPunch = 0;
}
window.resetHUD = resetHUD;

/** Déclenche une alerte plein écran (texte + sous-titre). */
function hudAlert(text, sub, color, durationMs) {
  HUD_STATE.alertText = text || '';
  HUD_STATE.alertSub = sub || '';
  HUD_STATE.alertColor = color || PALETTE.ui.warn;
  HUD_STATE.alertDur = Math.max(1, durationMs == null ? 1100 : durationMs);
  HUD_STATE.alertLeft = HUD_STATE.alertDur;
}
window.hudAlert = hudAlert;

/* -----------------------------------------------------------------------------
 *  Lectures tolérantes : le HUD ne doit JAMAIS faire tomber la frame parce
 *  qu'un module voisin est en cours de refonte.
 * -------------------------------------------------------------------------- */
function hudCombo() {
  try {
    if (typeof getComboMultiplier === 'function') return getComboMultiplier();
  } catch (e) { /* ignoré */ }
  return Math.max(1, Math.min(typeof comboCount !== 'undefined' ? comboCount : 1, TEMPO.COMBO_MAX));
}

function hudComboRaw() {
  return (typeof comboCount === 'number') ? comboCount : 0;
}

function hudComboFraction() {
  try {
    if (typeof getComboFraction === 'function') return getComboFraction();
  } catch (e) { /* ignoré */ }
  return 0;
}

/** Couleur de la chaîne : cyan → or → magenta à mesure qu'elle monte. */
function comboColor(mult) {
  const t = clamp((mult - 1) / Math.max(1, TEMPO.COMBO_MAX - 1), 0, 1);
  return t < 0.5
    ? PALETTE.mix(PALETTE.ui.accent, PALETTE.ui.combo, t * 2)
    : PALETTE.mix(PALETTE.ui.combo, PALETTE.ui.accentAlt, (t - 0.5) * 2);
}

/* =============================================================================
 *  HUD PRINCIPAL
 * ========================================================================== */
function drawHUD() {
  const c = ctx;
  if (!c) return;

  // TEMPS RÉEL : une alerte ou un compteur en cours de roulement doit finir sa
  // course même si le joueur met en pause juste après un impact — sans quoi le
  // HUD reste bloqué sur une valeur fausse tant que la pause dure.
  const dt = FRAME.rawDt;
  const S = UIKIT.scale();
  const W = CANVAS_WIDTH;
  const H = CANVAS_HEIGHT;
  const pad = Math.max(16, 24 * S);

  UIKIT.beginScreen('play');

  updateHudState(dt);

  drawScoreBlock(c, pad, S);
  drawAssaultCreditBlock(c, pad, S);
  drawStageBlock(c, S);
  drawLivesBlock(c, W - pad, S);
  drawComboGauge(c, pad, H - pad, S);
  drawWeaponGauge(c, W - pad, H - pad, S);
  drawPlayerStatus(c, S);
  drawAssaultManeuverZone(c, S);
  drawDangerFrame(c, S);
  drawHudAlert(c, S);

  // Pas de bouton en jeu : le pointeur disparaît pour ne pas parasiter l'action.
  UIKIT.endScreen('none');
}

function drawAssaultCreditBlock(c, pad, S) {
  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  if (!mode || mode.id !== 'assault' || typeof mode.getState !== 'function') return;
  const credits = Math.round(mode.getState().credits || 0);
  const y = Math.max(82, 92 * S);
  UIKIT.label(c, 'CRÉDITS', pad, y, PALETTE.ui.textDim, {
    size: 8.5 * S, tracking: 3.2 * S, align: 'left', alpha: 0.72
  });
  UIKIT.vector(c, credits + ' CR', pad, y + 7 * S, 18 * S, PALETTE.ui.combo, {
    align: 'left', tracking: 2.5 * S, width: 1.35 * S, alpha: 0.95
  });
}

/** Limite de pilotage verticale du mode Assaut, discrète mais explicite. */
function drawAssaultManeuverZone(c, S) {
  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  if (!mode || mode.id !== 'assault') return;

  const y = CANVAS_HEIGHT * 0.60;
  c.save();
  c.globalAlpha = 0.16;
  c.strokeStyle = PALETTE.ui.accent;
  c.lineWidth = Math.max(1, S);
  c.setLineDash([5 * S, 12 * S]);
  c.beginPath();
  c.moveTo(20 * S, y);
  c.lineTo(CANVAS_WIDTH - 20 * S, y);
  c.stroke();
  c.restore();

  UIKIT.label(c, 'ZONE DE MANŒUVRE', CANVAS_WIDTH / 2, y + 15 * S, PALETTE.ui.accent, {
    size: 8 * S, tracking: 3 * S, align: 'center', alpha: 0.22
  });
}

/* -----------------------------------------------------------------------------
 *  MISE À JOUR DES ANIMATIONS
 * -------------------------------------------------------------------------- */
function updateHudState(dt) {
  const st = HUD_STATE;

  /* ---- détection d'une nouvelle partie ----------------------------------- */
  // initGame() remet le score à zéro : c'est le seul moment où il DIMINUE.
  // On repart alors d'un HUD propre, sinon les 3 vies neuves déclencheraient
  // une alerte « VIE GAGNÉE » et le compteur défilerait à l'envers.
  if (score < st.lastScore - 1) resetHUD();

  /* ---- score qui roule --------------------------------------------------- */
  if (score < st.scoreShown - 2) {
    // nouvelle partie : on ne fait pas défiler le compteur à l'envers
    st.scoreShown = score;
  } else if (dt > 0) {
    st.scoreShown = (Math.abs(score - st.scoreShown) < 0.7)
      ? score
      : damp(st.scoreShown, score, 0.0009, dt);
  }
  if (score !== st.lastScore) {
    const gain = score - st.lastScore;
    st.lastScore = score;
    if (gain > 0) st.scorePunch = clamp(st.scorePunch + 0.35 + Math.min(0.45, gain / 400), 0, 1);
  }

  /* ---- vies -------------------------------------------------------------- */
  const lives = (typeof player !== 'undefined' && player) ? (player.lives | 0) : 0;
  if (st.lastLives < 0) {
    st.lastLives = lives;
  } else if (lives !== st.lastLives) {
    if (lives < st.lastLives) {
      st.livesPunch = 1;
      hudAlert('TOUCHÉ', lives > 0 ? (lives + (lives > 1 ? ' VIES RESTANTES' : ' VIE RESTANTE')) : '',
        PALETTE.ui.warn, 1000);
    } else {
      st.livesPunch = 0.8;
      hudAlert('VIE GAGNÉE', '', PALETTE.entities.powerupLife.glow, 900);
    }
    st.lastLives = lives;
  }

  /* ---- stage ------------------------------------------------------------- */
  const stage = (typeof stageSystem !== 'undefined' && stageSystem) ? stageSystem.currentStage : 1;
  // « 3-2 » = stage 3 de la deuxième boucle. La fonte vectorielle gère le tiret.
  const stageLabel = (typeof stageSystem !== 'undefined' && stageSystem && stageSystem.stageLabel)
    ? stageSystem.stageLabel() : String(stage);
  const bossStage = !!(typeof stageSystem !== 'undefined' && stageSystem &&
                       stageSystem.isBossStage && stageSystem.isBossStage());
  if (st.lastStage < 0) {
    st.lastStage = stage;
  } else if (stage !== st.lastStage) {
    st.lastStage = stage;
    st.stagePunch = 1;
    st.progressShown = 0;
    hudAlert('STAGE ' + stageLabel, bossStage ? 'ALERTE BOSS' : 'EN AVANT',
             bossStage ? PALETTE.ui.warn : PALETTE.ui.accent, 900);
  }

  /* ---- progression ------------------------------------------------------- */
  let prog = 0;
  if (typeof stageSystem !== 'undefined' && stageSystem && stageSystem.enemiesPerStage > 0) {
    prog = clamp(stageSystem.enemiesDefeated / stageSystem.enemiesPerStage, 0, 1);
  }
  st.progressShown = dt > 0 ? damp(st.progressShown, prog, 0.0004, dt) : prog;

  /* ---- combo ------------------------------------------------------------- */
  const raw = hudComboRaw();
  const mult = hudCombo();
  if (raw >= 2 && raw > st.lastCombo) {
    st.comboPunch = 1;
    st.comboPeak = Math.max(st.comboPeak, mult);
  }
  if (raw === 0 && st.lastCombo >= 3) st.comboBreak = 1;   // chaîne rompue : on le voit
  if (raw === 0) st.comboPeak = 0;
  st.lastCombo = raw;

  // Apparition franche, disparition plus lente : on doit VOIR la chaîne se
  // rompre, sinon la sanction passe inaperçue.
  const wantCombo = raw >= 2 ? 1 : 0;
  st.comboShow = dt > 0 ? damp(st.comboShow, wantCombo, wantCombo ? 0.00002 : 0.02, dt) : st.comboShow;
  if (st.comboShow < 0.004 && !wantCombo) st.comboShow = 0;

  /* ---- arme -------------------------------------------------------------- */
  const weapon = (typeof player !== 'undefined' && player) ? player.weapon : 'normal';
  if (weapon !== 'normal' && HUD_STATE._lastWeapon !== weapon) st.weaponPunch = 1;
  HUD_STATE._lastWeapon = weapon;

  /* ---- amortissements ---------------------------------------------------- */
  if (dt > 0) {
    st.scorePunch = damp(st.scorePunch, 0, 0.000004, dt);
    st.livesPunch = damp(st.livesPunch, 0, 0.00002, dt);
    st.stagePunch = damp(st.stagePunch, 0, 0.00004, dt);
    st.comboPunch = damp(st.comboPunch, 0, 0.000004, dt);
    st.comboBreak = damp(st.comboBreak, 0, 0.002, dt);
    st.weaponPunch = damp(st.weaponPunch, 0, 0.00002, dt);
    st.alertLeft = Math.max(0, st.alertLeft - FRAME.rawDtMs);
  }
}

/* -----------------------------------------------------------------------------
 *  BLOC SCORE (haut gauche)
 * -------------------------------------------------------------------------- */
function drawScoreBlock(c, pad, S) {
  const st = HUD_STATE;
  const y = Math.max(24, 30 * S);

  UIKIT.label(c, 'SCORE', pad, y, PALETTE.ui.textDim, {
    size: 10 * S, tracking: 4.5 * S, alpha: 0.8
  });

  const base = 27 * S;
  const size = base * (1 + st.scorePunch * 0.16);
  const shown = Math.round(st.scoreShown);
  const digits = String(shown);

  UIKIT.vector(c, digits, pad, y + 6 * S - (size - base) * 0.5, size, PALETTE.ui.accent, {
    tracking: size * 0.24,
    width: Math.max(1.4, size * 0.085),
    alpha: 0.9 + st.scorePunch * 0.1,
    glowScale: 1 + st.scorePunch * 0.6
  });

  // Le gain en attente d'affichage : un liseré derrière le compteur.
  const pending = score - st.scoreShown;
  if (pending > 0.7) {
    const w = UIKIT.vectorWidth(digits, size, { tracking: size * 0.24 });
    UIKIT.label(c, '+' + Math.round(pending), pad + w + 10 * S, y + 6 * S + size * 0.75,
      PALETTE.ui.combo, { size: 12 * S, tracking: 1.5 * S, alpha: 0.75 });
  }

  const best = Math.max(Number(highScore) || 0, score);
  UIKIT.label(c, 'MEILLEUR ' + best, pad, y + 6 * S + size + 15 * S, PALETTE.ui.textDim, {
    size: 10 * S, tracking: 2.2 * S, alpha: 0.6
  });
}

/* -----------------------------------------------------------------------------
 *  BLOC STAGE (haut centre) — titre + jauge segmentée
 * -------------------------------------------------------------------------- */
function drawStageBlock(c, S) {
  const st = HUD_STATE;
  const cx = CANVAS_WIDTH / 2;
  const y = Math.max(22, 28 * S);
  const stage = (typeof stageSystem !== 'undefined' && stageSystem && stageSystem.stageLabel)
    ? stageSystem.stageLabel()
    : ((typeof stageSystem !== 'undefined' && stageSystem) ? stageSystem.currentStage : 1);
  const per = (typeof stageSystem !== 'undefined' && stageSystem) ? (stageSystem.enemiesPerStage | 0) : 0;
  const done = (typeof stageSystem !== 'undefined' && stageSystem) ? (stageSystem.enemiesDefeated | 0) : 0;
  const mode = window.GALABOB && window.GALABOB.modes ? window.GALABOB.modes.current() : null;
  const assault = mode && mode.id === 'assault';
  const modeState = assault && typeof mode.getState === 'function' ? mode.getState() : null;

  const size = 15 * S * (1 + st.stagePunch * 0.28);
  UIKIT.vector(c, (assault ? 'ASSAUT ' : 'STAGE ') + stage, cx, y - size * 0.2, size,
    assault ? PALETTE.ui.combo : PALETTE.ui.text, {
    align: 'center', tracking: size * 0.32, width: Math.max(1.2, size * 0.085),
    alpha: 0.85 + st.stagePunch * 0.15, glowScale: 1 + st.stagePunch
  });

  const bw = clamp(CANVAS_WIDTH * 0.28, 180, 420);
  const bh = Math.max(5, 7 * S);
  const bx = cx - bw / 2;
  const by = y + size * 1.35;

  const frac = st.progressShown;
  const nearEnd = frac > 0.82;
  const col = nearEnd ? PALETTE.ui.good : PALETTE.ui.accent;

  UIKIT.bar(c, bx, by, bw, bh, frac, col, {
    segments: (per > 1 && per <= 40) ? per : 0,
    alpha: 0.9
  });

  // Repères d'extrémités
  const ends = new Path2D();
  ends.moveTo(bx - 6 * S, by - 3); ends.lineTo(bx - 6 * S, by + bh + 3);
  ends.moveTo(bx + bw + 6 * S, by - 3); ends.lineTo(bx + bw + 6 * S, by + bh + 3);
  NEON.custom(c, ends, col, 1.4, { alpha: 0.5 });

  const progressLabel = done + ' / ' + per;
  UIKIT.label(c, progressLabel, cx, by + bh + 15 * S, PALETTE.ui.textDim, {
    size: 10 * S, tracking: 2 * S, align: 'center', alpha: 0.7, mono: true
  });

  if (modeState) {
    const weapon = (typeof player !== 'undefined' && player) ? player.weapon : 'normal';
    let ammoText;
    if (weapon === 'double' || weapon === 'spread') {
      ammoText = weapon.toUpperCase() + ' · EXTENSION PERMANENTE';
    } else if (weapon !== 'normal') {
      ammoText = weapon.toUpperCase() + ' · ' + (modeState.ammo[weapon] || 0) + ' MUNITIONS';
    } else if (modeState.reloadRemaining > 0) {
      ammoText = 'RECHARGE · ' + (modeState.reloadRemaining / 1000).toFixed(1) + 's';
    } else {
      ammoText = 'CHARGEUR · ' + modeState.magazine + ' / ' + modeState.magazineMax;
    }
    UIKIT.label(c, ammoText, cx, by + bh + 29 * S,
      modeState.reloadRemaining > 0 ? PALETTE.ui.warn : PALETTE.ui.combo, {
        size: 9 * S, tracking: 2.2 * S, align: 'center', alpha: 0.82, mono: true
      });
  }

  if (nearEnd) {
    const p = 0.5 + 0.5 * Math.sin(FRAME.realTime * 7);
    UIKIT.label(c, 'DERNIERS ENNEMIS', cx, by - 8 * S, PALETTE.ui.good, {
      size: 9 * S, tracking: 4 * S, align: 'center', alpha: 0.35 + p * 0.5
    });
  }
}

/* -----------------------------------------------------------------------------
 *  BLOC VIES (haut droite) — icônes de vaisseau vectorielles
 * -------------------------------------------------------------------------- */
function drawLivesBlock(c, right, S) {
  const st = HUD_STATE;
  const y = Math.max(24, 30 * S);
  const lives = (typeof player !== 'undefined' && player) ? Math.max(0, player.lives | 0) : 0;

  UIKIT.label(c, 'VIES', right, y, PALETTE.ui.textDim, {
    size: 10 * S, tracking: 4.5 * S, align: 'right', alpha: 0.8
  });

  const iconSize = 15 * S;
  const step = iconSize + 9 * S;
  const iy = y + 22 * S;
  const slots = Math.min(Math.max(lives, 3), 6);

  const full = new Path2D();
  const empty = new Path2D();
  for (let i = 0; i < slots; i++) {
    const ix = right - iconSize / 2 - i * step;
    if (i < lives) UIKIT.addShipGlyph(full, ix, iy, iconSize * (1 + (i === lives - 1 ? st.livesPunch * 0.35 : 0)));
    else UIKIT.addShipGlyph(empty, ix, iy, iconSize);
  }

  NEON.custom(c, empty, PALETTE.ui.textDim, 1.2, { alpha: 0.28 });
  NEON.custom(c, full, lives <= 1 ? PALETTE.ui.warn : PALETTE.entities.player.glow,
    1.7 + st.livesPunch, {
      alpha: 0.9,
      glowScale: 1 + st.livesPunch * 1.6
    });

  if (lives > 6) {
    UIKIT.label(c, '×' + lives, right - iconSize / 2 - 6 * step - 6 * S, iy + 5 * S,
      PALETTE.entities.player.glow, { size: 13 * S, tracking: 1.5 * S, align: 'right', alpha: 0.9 });
  }

  // Perte de vie : les équerres du bloc claquent vers l'extérieur
  if (st.livesPunch > 0.02) {
    const grow = (1 - st.livesPunch) * 6 + st.livesPunch * 14;
    const bx = right - iconSize / 2 - (slots - 1) * step - iconSize * 0.8 - grow;
    const bw = (right + iconSize * 0.8 + grow) - bx;
    UIKIT.bracketFrame(c, bx, iy - iconSize - grow, bw, iconSize * 2 + grow * 2,
      PALETTE.ui.warn, { corner: 12, width: 1.8, alpha: st.livesPunch * 0.85 });
  }
}

/* -----------------------------------------------------------------------------
 *  CADRAN DE COMBO (bas gauche) — le meilleur levier de sensation du jeu
 * -------------------------------------------------------------------------- */
function drawComboGauge(c, pad, bottom, S) {
  const st = HUD_STATE;
  const show = st.comboShow;
  const brk = st.comboBreak;
  if (show < 0.01 && brk < 0.01) return;

  const mult = hudCombo();
  const frac = hudComboFraction();
  const t = clamp((mult - 1) / Math.max(1, TEMPO.COMBO_MAX - 1), 0, 1);
  const R = (26 + 12 * t) * S * (1 + st.comboPunch * 0.16);
  const cx = pad + R + 4 * S;
  const cy = bottom - R - 26 * S;
  const col = comboColor(mult);
  const a = show;

  // Halo de fond
  NEON.circle(c, cx, cy, R * 0.92, col, 1, {
    alpha: a * 0.12, fill: true, fillAlpha: 0.5 + st.comboPunch * 0.5, halo: false, passes: 2
  });

  // Graduations : une encoche par palier de multiplicateur
  const ticks = new Path2D();
  const maxT = Math.max(2, TEMPO.COMBO_MAX);
  for (let i = 0; i < maxT; i++) {
    const ang = -Math.PI / 2 + (i / maxT) * Math.PI * 2;
    const r0 = R + 5 * S, r1 = R + (i < mult ? 11 : 8) * S;
    ticks.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    ticks.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
  }
  NEON.custom(c, ticks, col, 1.6, { alpha: a * 0.4 });

  // Anneau de temps restant : il se vide, la tension est lisible
  UIKIT.arcGauge(c, cx, cy, R, frac, col, {
    width: 3.4 + st.comboPunch * 2.6,
    alpha: a * (0.85 + st.comboPunch * 0.15),
    glowScale: 1 + st.comboPunch
  });

  // Alerte de fin de chaîne : l'anneau bat de plus en plus vite
  if (frac > 0 && frac < 0.3) {
    const beat = 0.5 + 0.5 * Math.sin(FRAME.realTime * (10 + (1 - frac) * 24));
    NEON.ring(c, cx, cy, R + 4 * S, 1.6, col, { alpha: a * beat * 0.55 });
  }

  // Multiplicateur, en fonte vectorielle
  const txt = '×' + mult;
  const size = R * (0.86 + st.comboPunch * 0.2);
  const w = UIKIT.vectorWidth(txt, size, { tracking: size * 0.16 });
  UIKIT.vector(c, txt, cx - w / 2, cy - size * 0.5, size, col, {
    tracking: size * 0.16,
    width: Math.max(1.6, size * 0.1),
    alpha: a,
    glowScale: 1 + st.comboPunch * 1.4
  });

  UIKIT.label(c, 'CHAÎNE', cx, cy + R + 15 * S, col, {
    size: 9.5 * S, tracking: 4 * S, align: 'center', alpha: a * 0.7
  });

  // Éclat de montée : rayons courts qui s'échappent
  if (st.comboPunch > 0.03) {
    const rays = new Path2D();
    const k = st.comboPunch;
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + FRAME.time * 0.8;
      const r0 = R + 14 * S + (1 - k) * 22 * S;
      const r1 = r0 + 10 * S * k;
      rays.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      rays.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    }
    NEON.custom(c, rays, col, 2, { alpha: k * 0.8 });
  }

  // Rupture de chaîne : éclats rouges qui partent en étoile
  if (brk > 0.02) {
    const shards = new Path2D();
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + 0.4;
      const r0 = R * (0.6 + (1 - brk) * 1.4);
      const r1 = r0 + 16 * S * brk;
      shards.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      shards.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
    }
    NEON.custom(c, shards, PALETTE.ui.warn, 2.2, { alpha: brk * 0.85 });
    NEON.ring(c, cx, cy, R * (1 + (1 - brk) * 0.8), 2, PALETTE.ui.warn, { alpha: brk * 0.5 });
  }
}

/* -----------------------------------------------------------------------------
 *  JAUGE D'ARME (bas droite)
 * -------------------------------------------------------------------------- */
function drawWeaponGauge(c, right, bottom, S) {
  if (typeof player === 'undefined' || !player) return;
  const weapon = player.weapon || 'normal';
  const left = player.weaponTimer || 0;
  if (weapon === 'normal' || left <= 0) return;

  const runtime = (typeof window !== 'undefined') ? window.GALABOB : null;
  const mode = runtime && runtime.modes ? runtime.modes.current() : null;
  const assaultState = mode && mode.id === 'assault' && typeof mode.getState === 'function'
    ? mode.getState() : null;

  const st = HUD_STATE;
  const names = { double: 'TIR DOUBLE', spread: 'TIR DISPERSÉ', life: 'BOUCLIER' };
  const name = names[weapon] || String(weapon).toUpperCase();
  const col = PALETTE.weapon(weapon).glow;
  if (assaultState) {
    const extensions = weapon === 'double' || weapon === 'spread';
    const ammo = assaultState.ammo && assaultState.ammo[weapon] || 0;
    UIKIT.label(c, name, right, bottom - 28 * S, col, {
      size: 11 * S, tracking: 3.0 * S, align: 'right', alpha: 0.9
    });
    UIKIT.vector(c, extensions ? 'PERMANENT' : ammo + ' MUN', right, bottom - 8 * S,
      14 * S, col, { align: 'right', tracking: 2 * S, width: 1.2 * S, alpha: 0.9 });
    return;
  }
  const total = TEMPO.POWERUP_DURATION_MS || 9000;
  const frac = clamp(left / total, 0, 1);

  const w = clamp(CANVAS_WIDTH * 0.14, 110, 190);
  const h = Math.max(5, 6 * S);
  const x = right - w;
  const y = bottom - h - 6 * S;

  const urgent = left < 2200;
  const beat = urgent ? (0.45 + 0.55 * Math.abs(Math.sin(FRAME.realTime * 8))) : 1;

  UIKIT.label(c, name, right, y - 12 * S, col, {
    size: 11 * S, tracking: 3.4 * S, align: 'right',
    alpha: (0.75 + st.weaponPunch * 0.25) * beat
  });
  UIKIT.label(c, (left / 1000).toFixed(1) + 'S', x - 10 * S, y + h, col, {
    size: 10 * S, tracking: 1.2 * S, align: 'right', alpha: 0.6 * beat, mono: true
  });

  UIKIT.bar(c, x, y, w, h, frac, col, { alpha: 0.9 * beat, head: false });

  if (st.weaponPunch > 0.02) {
    UIKIT.bracketFrame(c, x - 8, y - 16 * S, w + 16, h + 26 * S, col, {
      corner: 10, width: 1.6, alpha: st.weaponPunch * 0.8
    });
  }
}

/* -----------------------------------------------------------------------------
 *  ÉTAT DU JOUEUR — i-frames, respawn, compte à rebours
 * -------------------------------------------------------------------------- */
function drawPlayerStatus(c, S) {
  if (typeof player === 'undefined' || !player) return;

  const cx = player.x + player.width / 2;
  const cy = player.y + player.height / 2;

  /* ---- respawn : équerres qui convergent sur le vaisseau ----------------- */
  if (player.respawning && player.respawnTimer > 0) {
    const total = TEMPO.PLAYER_RESPAWN_MS || 420;
    const k = clamp(player.respawnTimer / total, 0, 1);   // 1 → 0
    const spread = 18 + k * 90;
    const L = 12 + k * 10;
    const p = new Path2D();
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const sx = cx + corners[i][0] * spread;
      const sy = cy + corners[i][1] * spread;
      p.moveTo(sx - corners[i][0] * L, sy);
      p.lineTo(sx, sy);
      p.lineTo(sx, sy - corners[i][1] * L);
    }
    NEON.custom(c, p, 'player', 2, { alpha: 0.35 + (1 - k) * 0.55 });
    NEON.ring(c, cx, cy, spread * 1.15, 1.4, 'player', { alpha: k * 0.4 });
  }

  /* ---- invulnérabilité : bouclier qui se vide ---------------------------- */
  if (player.invulnerable && player.iframeTimer > 0) {
    const total = player.iframeDuration || TEMPO.PLAYER_IFRAME_MS || 1500;
    const frac = clamp(player.iframeTimer / total, 0, 1);
    const r = Math.max(player.width, player.height) * 0.85 + 8;
    const urgent = player.iframeTimer < 450;
    const beat = 0.55 + 0.45 * Math.sin(FRAME.realTime * (urgent ? 22 : 7));

    UIKIT.arcGauge(c, cx, cy, r, frac, urgent ? PALETTE.ui.warn : PALETTE.entities.playerShield.glow, {
      width: 2.4, alpha: 0.55 + beat * 0.35
    });
    NEON.ring(c, cx, cy, r * 0.86, 1.2, PALETTE.entities.playerShield.glow,
      { alpha: 0.16 + beat * 0.14 });

    // Compte à rebours lisible, au-dessus du vaisseau (le bas d'écran est déjà chargé)
    UIKIT.label(c, (player.iframeTimer / 1000).toFixed(1), cx, cy - r - 8 * S,
      urgent ? PALETTE.ui.warn : PALETTE.entities.playerShield.glow, {
        size: 10 * S, tracking: 1.2 * S, align: 'center', alpha: 0.55 + beat * 0.3, mono: true
      });
  }
}

/* -----------------------------------------------------------------------------
 *  CADRE DE DANGER — dernière vie
 * -------------------------------------------------------------------------- */
function drawDangerFrame(c, S) {
  if (typeof player === 'undefined' || !player) return;
  if ((player.lives | 0) > 1) return;

  const beat = 0.5 + 0.5 * Math.sin(FRAME.realTime * 3.2);
  const a = 0.14 + beat * 0.22;
  const m = 10;
  const L = 44 * S;

  const p = new Path2D();
  const W = CANVAS_WIDTH, H = CANVAS_HEIGHT;
  p.moveTo(m, m + L); p.lineTo(m, m); p.lineTo(m + L, m);
  p.moveTo(W - m - L, m); p.lineTo(W - m, m); p.lineTo(W - m, m + L);
  p.moveTo(W - m, H - m - L); p.lineTo(W - m, H - m); p.lineTo(W - m - L, H - m);
  p.moveTo(m + L, H - m); p.lineTo(m, H - m); p.lineTo(m, H - m - L);
  NEON.custom(c, p, PALETTE.ui.warn, 2.4, { alpha: a });

  // En haut, juste sous le compteur de stage : le bas de l'écran appartient au
  // vaisseau, et une alerte qu'on lit par-dessus son propre sprite est illisible.
  UIKIT.label(c, 'DERNIÈRE VIE', CANVAS_WIDTH / 2, Math.max(92, 96 * S), PALETTE.ui.warn, {
    size: 10 * S, tracking: 6 * S, align: 'center', alpha: a * 1.6
  });
}

/* -----------------------------------------------------------------------------
 *  ALERTE PLEIN ÉCRAN (perte de vie, entrée de stage…)
 * -------------------------------------------------------------------------- */
function drawHudAlert(c, S) {
  const st = HUD_STATE;
  if (st.alertLeft <= 0 || !st.alertText) return;

  const p = clamp(st.alertLeft / st.alertDur, 0, 1);       // 1 → 0
  const age = 1 - p;
  const pop = UIKIT.easeOutBack(clamp(age / 0.22, 0, 1));  // apparition à ressort
  const fade = p < 0.35 ? p / 0.35 : 1;                    // extinction
  const cx = CANVAS_WIDTH / 2;
  const cy = CANVAS_HEIGHT * 0.32;

  let size = clamp(CANVAS_WIDTH * 0.045, 26, 56) * pop;
  const track = size * 0.34;
  while (size > 12 && UIKIT.vectorWidth(st.alertText, size, { tracking: track }) > CANVAS_WIDTH * 0.8) {
    size *= 0.92;
  }

  const w = UIKIT.vectorWidth(st.alertText, size, { tracking: size * 0.34 });

  // Filets latéraux qui s'écartent
  const spread = (0.4 + age * 0.6) * CANVAS_WIDTH * 0.42;
  const rules = new Path2D();
  rules.moveTo(cx - w / 2 - 20 * S - spread, cy + size * 0.42);
  rules.lineTo(cx - w / 2 - 20 * S, cy + size * 0.42);
  rules.moveTo(cx + w / 2 + 20 * S, cy + size * 0.42);
  rules.lineTo(cx + w / 2 + 20 * S + spread, cy + size * 0.42);
  NEON.custom(c, rules, st.alertColor, 1.6, { alpha: fade * 0.5, cap: 'butt' });

  UIKIT.vector(c, st.alertText, cx, cy, size, st.alertColor, {
    align: 'center', tracking: size * 0.34, slant: 0.05,
    width: Math.max(1.4, size * 0.062),
    alpha: fade, glowScale: 1 + (1 - age) * 1.2
  });

  if (st.alertSub) {
    UIKIT.label(c, st.alertSub, cx, cy + size + 20 * S, st.alertColor, {
      size: 12 * S, tracking: 4.5 * S, align: 'center', alpha: fade * 0.75
    });
  }
}

/* =============================================================================
 *  PANNEAU DE DIAGNOSTIC (F3)
 * -----------------------------------------------------------------------------
 *  Appelé APRÈS la recomposition néon : il écrit sur le canvas visible, sans
 *  halo ni bloom. Volontairement gris-bleu, petit, en chasse fixe, collé en bas
 *  à gauche — l'ancien pavé vert en haut à gauche masquait le jeu.
 * ========================================================================== */
function drawDebugInfo() {
  if (!GAME_CONFIG.showDebugInfo) return;
  const c = (typeof NEON !== 'undefined' && NEON.mainCtx) ? NEON.mainCtx : ctx;
  if (!c) return;

  const lines = [];
  const push = function (k, v) { lines.push([k, v]); };

  push('FPS', (FRAME.fps || 0).toFixed(0) + '  q' + RENDER_CONFIG.quality +
              (RENDER_CONFIG.bloom ? ' bloom' : '') + '  dpr' + (DPR || 1));
  push('FRAME', (FRAME.dtMs || 0).toFixed(1) + ' ms' + (FRAME.frozen ? '  [HITSTOP]' : ''));

  if (typeof player !== 'undefined' && player) {
    push('JOUEUR', 'v=' + (player.speed || 0).toFixed(0) +
                   (player.usesPxPerSecond ? ' px/s' : ' px/f') +
                   (player.invulnerable ? '  i-frames ' + Math.round(player.iframeTimer) + 'ms' : ''));
  }
  if (typeof stageSystem !== 'undefined' && stageSystem) {
    push('STAGE', (stageSystem.stageLabel ? stageSystem.stageLabel() : stageSystem.currentStage) +
                  '/' + stageSystem.maxStage +
                  (stageSystem.menace ? '  menace ' + stageSystem.menace().menace.toFixed(2) : '') +
                  '   ' + stageSystem.enemiesDefeated + '/' + stageSystem.enemiesPerStage);
  }
  if (typeof BOSS !== 'undefined' && BOSS.isActive && BOSS.isActive()) {
    push('BOSS', BOSS.getName() + '  P' + BOSS.getPhase() +
                 '  ' + Math.round(BOSS.getHpFraction() * 100) + '%');
  }
  const n = function (a) { return (typeof a !== 'undefined' && a) ? a.length : 0; };
  push('ENTITÉS', 'ennemis ' + n(typeof enemies !== 'undefined' ? enemies : null) +
                  '  tirs ' + n(typeof playerBullets !== 'undefined' ? playerBullets : null) +
                  '/' + n(typeof enemyBullets !== 'undefined' ? enemyBullets : null) +
                  '  fx ' + n(typeof explosions !== 'undefined' ? explosions : null));
  push('COMBO', '×' + hudCombo() + '  ' + Math.round(hudComboFraction() * 100) + '%');

  if (typeof audioConfig !== 'undefined' && audioConfig) {
    push('AUDIO', (audioConfig.soundEnabled ? 'actif' : 'coupé') +
                  '  ' + ((audioConfig.musicList && audioConfig.musicList.length) || 0) + ' pistes');
  }

  const size = 11;
  const lh = 15;
  const pad = 10;
  const x = 12;
  // Calé au-dessus du cadran de combo, qui occupe déjà le coin bas-gauche.
  const y0 = CANVAS_HEIGHT - 132 - lines.length * lh;

  c.save();
  c.font = '500 ' + size + 'px ' + (typeof UIKIT !== 'undefined' ? UIKIT.FONT_NUM : 'monospace');
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';

  // fond très sombre pour rester lisible sur les explosions
  let wMax = 0;
  for (let i = 0; i < lines.length; i++) {
    wMax = Math.max(wMax, c.measureText(lines[i][0] + '  ' + lines[i][1]).width);
  }
  c.globalAlpha = 0.55;
  c.fillStyle = PALETTE.ui.shadow;
  c.fillRect(x - pad, y0 - lh, wMax + pad * 2, lines.length * lh + pad);

  c.globalAlpha = 1;
  for (let i = 0; i < lines.length; i++) {
    const ly = y0 + i * lh;
    c.fillStyle = PALETTE.ui.textDim;
    c.fillText(lines[i][0], x, ly);
    c.fillStyle = GAME_CONFIG.debugColor || PALETTE.ui.text;
    c.fillText(lines[i][1], x + 62, ly);
  }
  c.restore();
}
