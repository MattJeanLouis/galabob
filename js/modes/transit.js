/* =============================================================================
 *  POURSUITE INTERSECTORIELLE — rail-shooter 3D, vocabulaire Galabob.
 *  La route et la caméra sont automatiques. Le joueur pilote dans le corridor.
 * ========================================================================== */
const TRANSIT = (function () {
  'use strict';

  const ROUTE_END = 22000;
  // Objectif unique de la poursuite : un quota d'appareils détruits. Il n'y a
  // plus de cibles prioritaires à abattre, donc plus aucun verrou invisible :
  // la route qui s'achève suffit, et le saut part dès le quota atteint.
  // Seize éliminations tombent pendant la traversée (~54 s) au canon nu et
  // bien avant avec une arme ramassée : la sortie n'est jamais une attente.
  const KILL_TARGET = 16;
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const LANE_X = 42;
  const LANE_Y = 25;
  const S = {
    active: false, complete: false, from: 0, to: 0, loop: 0, mode: 'arcade', theme: 0, shipId: 'classic',
    t: 0, phase: 'chase', message: '', messageT: 0, route: { distance: 0, speed: 390, warp: 0, curveX: 0, curveY: 0, roll: 0 },
    ship: { x: 0, y: 0, z: 0, vx: 0, vy: 0, roll: 0, pitch: 0, speed: 390,
      inputX: 0, inputY: 0, kick: 0, muzzle: 0, hull: 100, invuln: 0 },
    enemies: [], asteroids: [], shots: [], enemyShots: [], effects: [], powerups: [],
    target: null, markers: null, fireCooldown: 0, enemyFireCooldown: 0, nextWave: 1500, wave: 0,
    eliteSpawned: 0, eliteKills: 0, kills: 0, gained: 0, jumpT: 0, nextEntityId: 1
  };

  function cl(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function damp(a, b, rate, dt) { return b + (a - b) * Math.pow(rate, dt); }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); }
  /** Ligne d'objectif du HUD : la seule condition de sortie de la mission. */
  function objectiveText() { return 'POURSUITE · ' + Math.min(S.kills, KILL_TARGET) + '/' + KILL_TARGET + ' ÉLIMINÉS'; }
  /** La sortie ne dépend que des ennemis abattus et de la fin de la route. */
  function escapeReady() { return S.route.distance >= ROUTE_END && S.kills >= KILL_TARGET; }
  function seeded(seed) {
    let value = (seed | 0) || 1;
    return function () { value += 0x6d2b79f5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function start(options) {
    S.active = true; S.complete = false;
    S.from = Math.max(1, options?.stage | 0); S.to = Math.max(1, options?.nextStage | 0);
    S.loop = Math.max(0, options?.loop | 0); S.mode = options?.mode || 'arcade';
    S.theme = (typeof BACKDROP !== 'undefined' && BACKDROP.themeIndex) ? BACKDROP.themeIndex() : (S.from - 1) % 10;
    S.shipId = options?.shipId || (typeof player !== 'undefined' && player.shipId) || 'classic';
    S.t = 0; S.phase = 'chase'; S.message = 'ESCORTE EN FUITE · INTERCEPTION'; S.messageT = 3;
    Object.assign(S.route, { distance: 0, speed: 390, warp: 0, curveX: 0, curveY: 0, roll: 0 });
    Object.assign(S.ship, { x: 0, y: 0, z: 0, vx: 0, vy: 0, roll: 0, pitch: 0, speed: 390,
      inputX: 0, inputY: 0, kick: 0, muzzle: 0, hull: 100, invuln: 1.5 });
    S.enemies.length = 0; S.asteroids.length = 0; S.shots.length = 0; S.enemyShots.length = 0;
    S.effects.length = 0; S.powerups.length = 0; S.fireCooldown = 0; S.enemyFireCooldown = 2.4; S.nextWave = 1500; S.wave = 0;
    S.eliteSpawned = 0; S.eliteKills = 0; S.kills = 0; S.gained = 0; S.jumpT = 0; S.nextEntityId = 1;
    const random = seeded(S.from * 991 + S.loop * 37);
    for (let i = 0; i < 9; i++) S.asteroids.push(newAsteroid(i, random, true));
    spawnWave();
    chooseTarget();
    try { INPUT?.reset?.(); } catch (_) { /* facultatif */ }
    try { gameEvent?.('divealert', {}); } catch (_) { /* audio */ }
    return true;
  }

  function newAsteroid(id, random, initial) {
    // Trois rochers seulement traversent le corridor. Ils sont petits,
    // espacés dans la profondeur et décalés d'un côté : l'autre moitié de
    // l'écran constitue donc toujours une échappatoire lisible.
    const hazard = id % 4 === 0;
    const scenic = !hazard;
    const side = random() < 0.5 ? -1 : 1;
    const hazardIndex = Math.floor(id / 4);
    const x = scenic ? side * (64 + random() * 145) : (hazardIndex % 2 ? 19 : -19);
    const y = scenic ? (random() - 0.5) * 140 : [-8, 10, 1][hazardIndex % 3];
    return { id, hazard, x, y,
      z: hazard && initial ? -650 - hazardIndex * 700 : (initial ? -300 - random() * 1900 : -1850 - random() * 650),
      r: hazard ? 5.2 + random() * 1.8 : 6 + random() * 10, rx: random() * 6, ry: random() * 6, rz: random() * 6, spin: 0.10 + random() * 0.34 };
  }

  function update(deltaMs) {
    if (!S.active || S.complete || !(deltaMs > 0)) return;
    const dt = Math.min(0.05, deltaMs / 1000);
    try { window.GALABOB?.combo?.step(deltaMs); } catch (_) { /* combo facultatif */ }
    try { window.updatePlayerPowerState?.(deltaMs); } catch (_) { /* équipement partagé */ }
    S.t += dt; S.messageT = Math.max(0, S.messageT - dt); S.ship.invuln = Math.max(0, S.ship.invuln - dt);
    const threatDt = dt * (window.playerTimeScale?.() || 1);
    updateRoute(dt); updatePlayer(dt); updateWeapons(deltaMs, dt); updateEnemies(threatDt); updateScenery(dt); updatePowerups(dt); chooseTarget();
    if (escapeReady() && S.phase !== 'jump') {
      S.phase = 'jump'; S.jumpT = 0; S.message = 'OBJECTIF ATTEINT · SAUT'; S.messageT = 2;
      try { gameEvent?.('stageClear', { stage: 'transit-pursuit' }); } catch (_) { /* audio */ }
    }
    if (S.phase === 'jump') {
      S.jumpT += dt;
      if (S.jumpT > 2.15) S.complete = true;
    } else if (S.route.distance >= ROUTE_END && !escapeReady()) {
      // Quota non atteint : la route s'étire, mais elle reste finissable — les
      // vagues normales continuent d'arriver, donc la sortie est toujours à
      // portée de tir. Aucune cible obligatoire ne peut plus bloquer ici.
      S.message = objectiveText() + ' · POURSUITE MAINTENUE'; S.messageT = Math.max(S.messageT, 0.2);
    }
  }

  function warpAmount(distance) {
    const band = (start, end) => cl(Math.min((distance - start) / 500, (end - distance) / 500), 0, 1);
    return Math.max(band(5900, 7900), band(14200, 16000), S.phase === 'jump' ? cl(S.jumpT / 0.7, 0, 1) : 0);
  }

  function updateRoute(dt) {
    const r = S.route;
    r.warp = warpAmount(r.distance);
    const wanted = S.phase === 'jump' ? 1250 : 410 + r.warp * 700;
    r.speed = damp(r.speed, wanted, S.phase === 'jump' ? 0.01 : 0.04, dt);
    r.distance += r.speed * dt;
    // Courbe entièrement scénarisée : grande orbite autour du premier astre,
    // plongée puis slalom. Les commandes ne modifient jamais cette route.
    let curveX = Math.sin(r.distance * 0.00052) * 0.34;
    let curveY = Math.sin(r.distance * 0.00041 + 1.4) * 0.22;
    if (r.distance > 4300 && r.distance < 9600) {
      const q = (r.distance - 4300) / 5300;
      curveX += Math.sin(q * Math.PI) * 1.38;
      curveY += Math.sin(q * Math.PI * 2) * 0.46;
    }
    if (r.distance > 11900 && r.distance < 18100) {
      const q = (r.distance - 11900) / 6200;
      curveX -= Math.sin(q * Math.PI) * 1.08;
      curveY += Math.sin(q * Math.PI * 3) * 0.38;
    }
    r.curveX = curveX; r.curveY = curveY;
    r.roll = damp(r.roll, -r.curveX * 0.145, 0.018, dt);
    S.ship.speed = r.speed;
    while (r.distance >= S.nextWave && S.phase !== 'jump') {
      spawnWave(); S.nextWave += 1650 + (S.wave % 3) * 210;
    }
    const eliteMarks = [3300, 10300, 17400];
    while (S.eliteSpawned < 3 && r.distance >= eliteMarks[S.eliteSpawned]) spawnElite(S.eliteSpawned++);
  }

  function updatePlayer(dt) {
    const x = typeof INPUT !== 'undefined' ? INPUT.axisX() : 0;
    const y = typeof INPUT !== 'undefined' ? INPUT.axisY() : 0;
    S.ship.inputX = x; S.ship.inputY = y;
    S.ship.kick = damp(S.ship.kick, 0, 3e-8, dt);
    S.ship.muzzle = Math.max(0, S.ship.muzzle - dt * 9.5);
    // Réponse proche du mode 2D : accélération franche, freinage encore plus
    // court et aucune dérive une fois la touche relâchée.
    const approach = (value, target, amount) => value < target ? Math.min(target, value + amount) : Math.max(target, value - amount);
    const wantedVx = x * 98, wantedVy = y ? -y * 80 : 0;
    S.ship.vx = approach(S.ship.vx, wantedVx, (x ? 1650 : 2300) * dt);
    S.ship.vy = approach(S.ship.vy, wantedVy, (y ? 1500 : 2150) * dt);
    S.ship.x = cl(S.ship.x + S.ship.vx * dt, -LANE_X, LANE_X);
    S.ship.y = cl(S.ship.y + S.ship.vy * dt, -LANE_Y, LANE_Y);
    if ((S.ship.x <= -LANE_X && S.ship.vx < 0) || (S.ship.x >= LANE_X && S.ship.vx > 0)) S.ship.vx *= 0.15;
    if ((S.ship.y <= -LANE_Y && S.ship.vy < 0) || (S.ship.y >= LANE_Y && S.ship.vy > 0)) S.ship.vy *= 0.15;
    S.ship.roll = damp(S.ship.roll, -x * 0.38, x ? 1e-22 : 1e-16, dt);
    S.ship.pitch = damp(S.ship.pitch, -y * 0.085, y ? 1e-22 : 1e-16, dt);
  }

  function spawnWave() {
    const waveId = S.wave++;
    const pattern = waveId % 5;
    const count = 5 + (waveId % 2);
    const types = ['normal', 'shooter', 'fast', 'normal', 'armored'];
    for (let i = 0; i < count; i++) {
      const spread = (i - (count - 1) / 2);
      let x = spread * 14, y = pattern % 2 ? Math.abs(spread) * 6 - 11 : Math.abs(spread) * 5 - 8;
      if (pattern === 1) y = Math.cos(i / Math.max(1, count - 1) * Math.PI) * 13;
      if (pattern === 2) { const a = i / count * Math.PI * 2; x = Math.cos(a) * 31; y = Math.sin(a) * 18; }
      if (pattern === 3) { x = (i % 2 ? -1 : 1) * (14 + Math.floor(i / 2) * 11); y = spread * 5; }
      if (pattern === 4) y = 9 - Math.abs(spread) * 6;
      const type = types[(pattern + i) % types.length];
      const hp = type === 'armored' ? 4 : (type === 'shooter' ? 2 : 1);
      S.enemies.push({ id: (waveId + 1) * 20 + i, waveId, slot: i, pattern, type, elite: false, alive: true, hp, hpMax: hp,
        x, y, baseX: x, baseY: y, z: -980 - (i % 2) * 9, holdZ: -205 - (pattern % 2) * 12,
        age: 0, phase: i * 1.37, fire: 1.1 + i * 0.31, points: type === 'armored' ? 45 : type === 'shooter' ? 20 : type === 'fast' ? 15 : 10 });
    }
    while (S.enemies.length > 34) {
      const disposable = S.enemies.findIndex((enemy) => !enemy.elite);
      if (disposable < 0) break;
      S.enemies.splice(disposable, 1);
    }
  }

  /** Les élites restent des appareils coriaces et bien payés, mais ils ne
   *  conditionnent plus la sortie : ce ne sont plus des cibles obligatoires. */
  function spawnElite(index) {
    const x = [-34, 30, 0][index % 3], y = [-12, 15, -18][index % 3];
    S.enemies.push({ id: 900 + index, type: 'elite', elite: true, alive: true,
      hp: 14 + index * 3, hpMax: 14 + index * 3, x, y, baseX: x, baseY: y,
      z: -1250, holdZ: -285, age: 0, phase: index * 2.1, fire: 0.8, points: 750 });
    S.message = 'APPAREIL LOURD EN VUE'; S.messageT = 2.2;
  }

  function updateEnemies(dt) {
    S.enemyFireCooldown = Math.max(0, S.enemyFireCooldown - dt);
    const readyToFire = [];
    for (const e of S.enemies) {
      if (!e.alive) continue;
      e.age += dt;
      e.z = Math.min(e.holdZ, e.z + (e.elite ? 150 : 185) * dt);
      // Entrées chorégraphiées puis mouvement collectif : exactement comme
      // les formations 2D, la vague est lisible avant de devenir vivante.
      const sharedPhase = (e.waveId ?? e.id) * 0.73;
      const sharedX = Math.sin(e.age * 0.82 + sharedPhase) * (e.elite ? 9 : 5.5);
      const sharedY = Math.sin(e.age * 1.06 + sharedPhase * 0.61) * (e.elite ? 5 : 2.8);
      const flutter = e.elite ? 0 : Math.sin(e.age * 2.1 + e.slot * 1.7) * (e.type === 'fast' ? 2.2 : 0.8);
      const entry = cl(e.age / 1.5, 0, 1);
      const enterEase = 1 - Math.pow(1 - entry, 3);
      const side = (e.pattern % 2 ? -1 : 1);
      const introX = side * 54 * (1 - enterEase);
      const introY = Math.sin(entry * Math.PI * (1.2 + e.pattern * 0.16)) * (22 + e.pattern * 2) * (1 - enterEase);
      const diveWindow = !e.elite && e.age > 4.5 ? Math.max(0, Math.sin((e.age - 4.5) * 0.72 + sharedPhase)) : 0;
      const dive = diveWindow > 0.82 ? (diveWindow - 0.82) / 0.18 : 0;
      e.x = e.baseX + sharedX + flutter + introX + side * dive * 9;
      e.y = e.baseY + sharedY + flutter * 0.35 + introY + dive * 7;
      e.fire -= dt;
      const armed = e.elite || e.type === 'shooter' || e.type === 'armored';
      if (armed && e.fire <= 0 && e.z > -720) readyToFire.push(e);
      if (!e.elite && e.age > 13) e.alive = false;
    }
    // Un seul tireur à la fois : les salves sont cadencées, visibles et
    // apprenables. On conserve en outre un plafond absolu de projectiles.
    if (readyToFire.length && S.enemyFireCooldown <= 0 && S.enemyShots.length < 7 && S.phase !== 'jump' && S.route.warp < 0.65) {
      const e = readyToFire[(S.wave + S.kills) % readyToFire.length];
      e.fire = e.elite ? 0.8 : (e.type === 'shooter' ? 1.35 : 2.35);
      S.enemyFireCooldown = e.elite ? 0.72 : (S.mode === 'assault' ? 1.02 : 0.86);
      const speed = e.elite ? 305 : 282;
      const d = Math.hypot(S.ship.x - e.x, S.ship.y - e.y, -e.z) || 1;
      S.enemyShots.push({ x: e.x, y: e.y, z: e.z, vx: (S.ship.x - e.x) / d * speed,
        vy: (S.ship.y - e.y) / d * speed, vz: (-e.z) / d * speed, life: 4.8 });
    }
    S.enemies = S.enemies.filter((e) => e.alive);
    for (let i = S.enemyShots.length - 1; i >= 0; i--) {
      const b = S.enemyShots[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt;
      if (b.z > -18 && Math.abs(b.x - S.ship.x) < 5.2 && Math.abs(b.y - S.ship.y) < 4.5) { damageShip(10); S.enemyShots.splice(i, 1); }
      else if (b.life <= 0 || b.z > 50) S.enemyShots.splice(i, 1);
    }
  }

  function updateWeapons(deltaMs, dt) {
    S.fireCooldown = Math.max(0, S.fireCooldown - deltaMs);
    const wants = typeof INPUT !== 'undefined' && (INPUT.shoot() || INPUT.shootBuffered());
    if (wants && S.fireCooldown <= 0 && S.phase !== 'jump') {
      const mode = window.GALABOB?.modes?.current?.();
      if (mode?.requestShot && !mode.requestShot(player?.weapon || 'normal')) {
        S.fireCooldown = 70;
        try { INPUT.consumeShoot?.(); } catch (_) { /* entrée */ }
      } else {
        const equipped = window.playerActiveWeapons?.() || [];
        const weapons = equipped.length ? equipped : [{ type: 'normal', level: 1 }];
        const rapid = weapons.some((item) => item.type === 'mitraille' || item.type === 'laser');
        let interval = rapid ? 68 : (S.mode === 'assault' ? 170 : 112);
        if (window.playerHasMod?.('surcharge')) interval *= 0.68;
        if (window.playerHasMod?.('furie')) interval *= 0.72;
        if (player?.shipStats?.fireRateMultiplier) interval /= player.shipStats.fireRateMultiplier;
        S.fireCooldown = Math.max(46, interval);
        for (const equippedWeapon of weapons) fireWeapon(equippedWeapon.type, equippedWeapon.level || 1);
        S.ship.kick = Math.min(1.25, S.ship.kick + 0.72);
        S.ship.muzzle = 1;
        try { JUICE?.preset?.('playerShot', 0.38); } catch (_) { /* retour sensoriel */ }
        if (S.shots.length > 90) S.shots.splice(0, S.shots.length - 90);
        try { INPUT.consumeShoot?.(); gameEvent?.('playerShot', { weapon: player?.weapon || 'normal' }); } catch (_) { /* audio */ }
      }
    }
    for (let i = S.shots.length - 1; i >= 0; i--) {
      const b = S.shots[i]; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.life -= dt;
      let hit = null;
      for (const e of S.enemies) {
        const radius = e.elite ? 21 : e.type === 'armored' ? 15 : e.type === 'shooter' ? 14 : 12.5;
        if (e.alive && Math.abs(b.z - e.z) < (e.elite ? 42 : 32) && Math.hypot(b.x - e.x, b.y - e.y) < radius) { hit = e; break; }
      }
      if (hit) {
        const mode = window.GALABOB?.modes?.current?.();
        const damageScale = mode?.damageMultiplier?.() || 1;
        hit.hp -= (b.damage || 1) * damageScale; impact(b.x, b.y, b.z, false, hit.type);
        if (hit.hp <= 0) killEnemy(hit);
        if (b.pierce > 0 && hit.hp > 0) b.pierce--;
        else S.shots.splice(i, 1);
      } else if (b.life <= 0 || b.z < -1800) S.shots.splice(i, 1);
    }
  }

  function fireWeapon(type, level) {
    const lvl = cl(level | 0, 1, 3);
    let lanes = [0], damage = 1, pierce = 0;
    if (type === 'double') lanes = lvl >= 2 ? [-0.055, 0, 0.055] : [-0.042, 0.042];
    else if (type === 'spread') lanes = lvl >= 3 ? [-0.23, -0.115, 0, 0.115, 0.23] : [-0.15, 0, 0.15];
    else if (type === 'missiles') { lanes = [-0.075, 0.075]; damage = 2 + lvl; }
    else if (type === 'onde') { lanes = [-0.10, 0, 0.10]; pierce = 2 + lvl; }
    else if (type === 'laser') { lanes = [0]; damage = 1 + (lvl > 1 ? 1 : 0); pierce = 3; }
    else if (type === 'mitraille') lanes = [Math.sin(S.t * 31) * 0.018];
    for (const angle of lanes) {
      const muzzleOffset = type === 'double' || type === 'missiles' ? angle * 92 : angle * 18;
      const x = S.ship.x + muzzleOffset, y = S.ship.y + 0.8, z = -12;
      S.shots.push({ x, y, z, ox: x, oy: y, oz: z, type,
        vx: angle * 330, vy: 0, vz: type === 'missiles' ? -920 : -1120,
        damage, pierce, life: type === 'missiles' ? 1.85 : 1.55 });
    }
  }

  function killEnemy(e) {
    e.alive = false; S.kills++; if (e.elite) S.eliteKills++;
    let combo = 1;
    try { combo = window.GALABOB?.combo?.registerKill?.() || 1; } catch (_) { /* combo facultatif */ }
    try { if (typeof comboCount === 'number') comboCount = combo; if (combo > 1) gameEvent?.('comboUp', { combo }); } catch (_) { /* legacy */ }
    const earned = award(e.points); impact(e.x, e.y, e.z, true, e.type);
    const killEffect = S.effects[S.effects.length - 1];
    killEffect.points = earned;
    const mode = window.GALABOB?.modes?.current?.();
    const roll = ((e.id * 37 + S.kills * 17) % 100) / 100;
    const pick = ((e.id * 61 + S.kills * 29) % 100) / 100;
    const reward = mode?.enemyKilled?.({ type: e.type, cause: 'bullet', basePoints: e.points, points: earned });
    if (reward?.credits) killEffect.credits = reward.credits;
    const customDrop = mode?.rollEnemyDrop?.({ enemy: e, roll, pick });
    if (customDrop) dropPowerup(e.x, e.y, e.z, e.id, customDrop);
    else if (customDrop === undefined && (e.elite || roll < 0.065)) dropPowerup(e.x, e.y, e.z, e.elite ? S.eliteKills : e.id);
    if (e.elite) { S.message = objectiveText(); S.messageT = 2.0; }
  }

  function dropPowerup(x, y, z, seed, forcedType) {
    const type = forcedType || window.rollPowerUpType?.() || ['double', 'spread', 'mitraille', 'bouclier'][Math.abs(seed | 0) % 4];
    S.powerups.push({ id: S.nextEntityId++, type,
      x: cl(x, -LANE_X + 4, LANE_X - 4), y: cl(y, -LANE_Y + 3, LANE_Y - 3), z, age: 0 });
  }

  function updatePowerups(dt) {
    for (let i = S.powerups.length - 1; i >= 0; i--) {
      const p = S.powerups[i]; p.age += dt; p.z += 150 * dt; p.y += Math.sin(p.age * 4) * dt * 3;
      if (window.playerHasMod?.('aimant') && p.z > -290) {
        const pull = cl((p.z + 290) / 270, 0, 1);
        p.x = damp(p.x, S.ship.x, Math.pow(0.035, pull), dt);
        p.y = damp(p.y, S.ship.y, Math.pow(0.035, pull), dt);
      }
      if (p.z > -16 && Math.abs(p.x - S.ship.x) < 13 && Math.abs(p.y - S.ship.y) < 11) {
        const marker = S.markers?.powerups?.find((item) => item?.id === p.id);
        window.applyPowerUp?.(p.type, marker?.x, marker?.y);
        if (p.type === 'bombe') {
          for (const enemy of S.enemies.slice()) {
            if (!enemy.alive) continue;
            if (enemy.elite) { enemy.hp -= 6; impact(enemy.x, enemy.y, enemy.z, false, enemy.type); if (enemy.hp <= 0) killEnemy(enemy); }
            else killEnemy(enemy);
          }
        }
        // applyPowerUp affiche déjà le libellé et sa gerbe : aucune deuxième
        // bannière locale ne vient concurrencer cette confirmation.
        S.powerups.splice(i, 1);
      } else if (p.z > 55) S.powerups.splice(i, 1);
    }
  }

  function updateScenery(dt) {
    const random = seeded((S.from * 1009 + Math.floor(S.route.distance / 180)) | 0);
    for (const a of S.asteroids) {
      a.z += (115 + S.route.warp * 460) * dt; a.rx += a.spin * dt; a.ry += a.spin * 0.7 * dt;
      if (a.z > 70) Object.assign(a, newAsteroid(a.id, random, false));
      if (a.hazard && S.ship.invuln <= 0 && a.z > -18 && a.z < 12 && Math.hypot(a.x - S.ship.x, a.y - S.ship.y) < a.r + 3.8) damageShip(18);
    }
    for (let i = S.effects.length - 1; i >= 0; i--) { S.effects[i].life -= dt; if (S.effects[i].life <= 0) S.effects.splice(i, 1); }
  }

  function impact(x, y, z, big, type) {
    const effect = { id: S.nextEntityId++, x, y, z, life: big ? 0.82 : 0.24, max: big ? 0.82 : 0.24,
      big: !!big, type: type || 'normal', bridged: false };
    S.effects.push(effect);
    if (S.effects.length > 36) S.effects.shift();
    try { JUICE?.preset?.(big ? (type === 'elite' ? 'bigKill' : 'enemyKill') : 'enemyHit', big ? 0.82 : 0.52); } catch (_) { /* effets */ }
    try { gameEvent?.(big ? 'enemyKill' : 'enemyHit', { type: type || 'normal' }); } catch (_) { /* audio */ }
  }

  function award(points) {
    let multiplier = 1;
    try { multiplier = window.GALABOB?.combo?.multiplier?.() || 1; } catch (_) { /* combo facultatif */ }
    try { if (typeof playerScoreMultiplier === 'function') multiplier *= playerScoreMultiplier(); } catch (_) { /* bonus facultatif */ }
    const earned = Math.round(points * multiplier);
    S.gained += earned;
    try { if (typeof score === 'number') score += earned; } catch (_) { /* score local seulement */ }
    try {
      if (typeof stageSystem !== 'undefined' && stageSystem.stageStats) {
        stageSystem.stageStats.score += earned;
        stageSystem.stageStats.combo = Math.max(stageSystem.stageStats.combo || 0, Math.round(multiplier));
      }
    } catch (_) { /* statistiques facultatives */ }
    return earned;
  }

  function damageShip(amount) {
    if (S.ship.invuln > 0 || S.phase === 'jump') return;
    const shipMarker = S.markers?.ship;
    if (window.consumePlayerShield?.('transit', shipMarker?.x, shipMarker?.y)) {
      S.ship.invuln = 0.85; S.message = 'BOUCLIER ROMPU'; S.messageT = 1.2; return;
    }
    S.ship.hull = Math.max(0, S.ship.hull - amount); S.ship.invuln = 0.85;
    S.message = 'IMPACT · INTÉGRITÉ ' + S.ship.hull + '%'; S.messageT = 1;
    try { JUICE?.shake?.(0.38); JUICE?.flash?.('#ff3557', 180, 0.28); } catch (_) { /* effets */ }
    if (S.ship.hull <= 0) {
      if (shipMarker?.visible) {
        try { createExplosion?.(shipMarker.x, shipMarker.y, 'player', { scale: 1.45 }); } catch (_) { /* visuel */ }
        try { createDebris?.(shipMarker.x, shipMarker.y, PALETTE.get('player').burst, 'fast'); } catch (_) { /* visuel */ }
      }
      if (typeof player !== 'undefined') player.lives--;
      if (typeof player !== 'undefined' && player.lives <= 0 && typeof triggerGameOver === 'function') { reset(); triggerGameOver(); return; }
      S.ship.hull = 100; S.ship.invuln = 2.2; S.ship.x = 0; S.ship.y = 0;
      // Le HUD commun annonce déjà la vie perdue. Il reste l'unique message.
      S.message = ''; S.messageT = 0;
    }
  }

  function chooseTarget() {
    let best = null, value = Infinity;
    for (const e of S.enemies) {
      if (!e.alive) continue;
      const aim = Math.hypot(e.x - S.ship.x, e.y - S.ship.y) + Math.abs(e.z) * 0.03 - (e.elite ? 80 : 0);
      if (aim < value) { best = e; value = aim; }
    }
    S.target = best;
  }

  function fallback(c) {
    c.save(); c.fillStyle = '#030711'; c.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); c.fillStyle = '#9edce8';
    for (let i = 0; i < 180; i++) c.fillRect((i * 193) % CANVAS_WIDTH, (i * 83 + S.route.distance * 0.3) % CANVAS_HEIGHT, 2, 2);
    c.restore();
  }

  function draw(c) {
    if (!S.active || !c) return;
    // Les constantes Canvas sont lexicales (elles ne vivent pas sur window).
    // On transmet donc explicitement le viewport réel au module ES 3D.
    let result = null; try { result = window.TRANSIT3D?.frame(S, CANVAS_WIDTH, CANVAS_HEIGHT); } catch (_) { result = null; }
    // Le contexte de scène possède déjà la transformation JUICE appliquée par
    // NEON.beginFrame(). La réappliquer ici décalait le vaisseau deux fois,
    // alors que les projectiles Canvas ne l'étaient qu'une seule fois.
    if (result?.canvas) { c.save(); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.drawImage(result.canvas, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT); c.restore(); S.markers = result.markers || null; bridgeSharedEffects(); }
    else fallback(c);
    drawHud(c);
  }

  /** Convertit une position 3D en événement du pipeline Canvas historique.
   *  Les explosions, éclats et nombres sont donc littéralement ceux du 2D. */
  function bridgeSharedEffects() {
    const markers = S.markers?.effects || [];
    for (const effect of S.effects) {
      if (effect.bridged) continue;
      const marker = markers.find((item) => item?.id === effect.id);
      if (!marker?.visible) continue;
      effect.bridged = true;
      const triplet = PALETTE.enemy(effect.type || 'normal');
      if (effect.big) {
        try { createExplosion?.(marker.x, marker.y, effect.type, { scale: effect.type === 'elite' ? 1.35 : 1 }); } catch (_) { /* visuel */ }
        try { createDebris?.(marker.x, marker.y, triplet.burst, effect.type); } catch (_) { /* visuel */ }
        if (effect.points) try { createScorePopup?.(marker.x, marker.y, effect.points, 1); } catch (_) { /* visuel */ }
        if (effect.credits && typeof scorePopups !== 'undefined') scorePopups.push({
          x: marker.x + 30, y: marker.y + 16, points: 0, text: '+' + effect.credits + ' CR',
          lifetime: 1.15, dy: -0.85, color: 'combo'
        });
      } else {
        try { createImpactSparks?.(marker.x, marker.y, triplet.burst, Math.PI / 2, 6); } catch (_) { /* visuel */ }
      }
    }
  }

  function drawHud(c) {
    const W = CANVAS_WIDTH, H = CANVAS_HEIGHT, ship = S.ship;
    const aim = S.markers?.aim;
    const cx = aim?.visible ? aim.x : W / 2, cy = aim?.visible ? aim.y : H * 0.48;
    // Projectiles en vecteurs 2D nets par-dessus la profondeur WebGL : même
    // grammaire visuelle que le mode classique, sans devenir minuscules au loin.
    for (const b of S.markers?.playerShots || []) if (b?.visible) {
      const scale = cl(b.scale, 0.42, 1.1);
      NEON.line(c, b.tx, b.ty, b.x, b.y, 'bulletPlayer', 2.2 + scale * 1.6,
        { alpha: 0.72, passes: 3, composite: 'lighter', glowScale: 0.82 });
      NEON.line(c, b.tx + (b.x - b.tx) * 0.52, b.ty + (b.y - b.ty) * 0.52, b.x, b.y,
        'playerCore', 0.8 + scale * 0.5, { alpha: 0.96, passes: 2, halo: false, composite: 'lighter' });
      NEON.dot(c, b.x, b.y, 1.6 + scale * 1.6, 'bulletPlayer', { alpha: 1, glowScale: 0.8, composite: 'lighter' });
    }
    for (const b of S.markers?.enemyShots || []) if (b?.visible) {
      const scale = cl(b.scale, 0.45, 1.05), r = 3.2 + scale * 3.0;
      if (b.impactVisible) {
        const urgency = cl(1 - b.eta / 1.25, 0, 1);
        NEON.line(c, b.x, b.y, b.ix, b.iy, 'bulletEnemy', 0.7,
          { alpha: 0.08 + urgency * 0.13, passes: 1, halo: false, dash: [2, 9] });
        NEON.ring(c, b.ix, b.iy, 8 + b.eta * 5, b.threat ? 1.45 : 0.9, 'bulletEnemy',
          { alpha: (b.threat ? 0.48 : 0.24) + urgency * 0.30, dash: [3, 5], dashOffset: REDUCED_MOTION ? 0 : S.t * 44, passes: b.threat ? 3 : 1 });
        if (b.threat && b.eta < 0.55) NEON.dot(c, b.ix, b.iy, 2.2 + urgency * 1.8, 'bulletEnemy',
          { alpha: 0.74, glowScale: 0.42, passes: 2 });
      }
      NEON.line(c, b.tx, b.ty, b.x, b.y, 'bulletEnemy', 1.8 + scale,
        { alpha: 0.48, passes: 3, composite: 'lighter' });
      NEON.shape(c, [b.x, b.y-r, b.x+r*0.72, b.y, b.x, b.y+r, b.x-r*0.72, b.y],
        'bulletEnemy', 1.2 + scale, { alpha: 0.94, fill: true, fillAlpha: 0.30, passes: 3, composite: 'lighter' });
      NEON.dot(c, b.x, b.y, 1.2 + scale, 'bulletEnemy', { alpha: 1, glowScale: 0.7 });
    }
    // Le sprite montre l'objet dans l'espace ; l'anneau montre où traverser
    // pour le ramasser sur le plan du vaisseau.
    for (const p of S.markers?.powerups || []) if (p?.visible && p.landingVisible) {
      const key = 'powerup.' + (p.type || 'double');
      const close = cl(1 - p.eta / 1.5, 0, 1);
      const pulse = REDUCED_MOTION ? 0 : Math.sin(S.t * 9) * (0.7 + close * 0.8);
      NEON.line(c, p.x, p.y, p.lx, p.ly, key, 0.8,
        { alpha: 0.10 + close * 0.12, passes: 1, halo: false, dash: [3, 10] });
      NEON.ring(c, p.lx, p.ly, 13 + pulse, 1.2 + close * 0.5, key,
        { alpha: 0.42 + close * 0.34, dash: [6, 4], dashOffset: REDUCED_MOTION ? 0 : -S.t * 34, passes: 2 });
      if (close > 0.55) NEON.dot(c, p.lx, p.ly, 1.8 + close, key,
        { alpha: 0.72, glowScale: 0.36, passes: 1 });
    }
    // Un seul curseur à l'écran : cyan = destination exacte du canon central.
    // L'ancien verrou rouge d'ennemi ressemblait à un second viseur et pouvait
    // pointer une cible hors formation, jusque dans un coin de l'écran.
    NEON.ring(c, cx, cy, 9, 1.15, 'player', { alpha: 0.58, dash: [3, 5], passes: 2 });
    NEON.dot(c, cx, cy, 1.6, 'playerCore', { alpha: 0.88, glowScale: 0.28, passes: 1 });
    NEON.line(c, cx - 18, cy, cx - 11, cy, 'playerCore', 0.9, { alpha: 0.58, passes: 1, halo: false });
    NEON.line(c, cx + 11, cy, cx + 18, cy, 'playerCore', 0.9, { alpha: 0.58, passes: 1, halo: false });
    NEON.line(c, cx, cy - 18, cx, cy - 11, 'playerCore', 0.9, { alpha: 0.58, passes: 1, halo: false });
    NEON.line(c, cx, cy + 11, cx, cy + 18, 'playerCore', 0.9, { alpha: 0.58, passes: 1, halo: false });
    for (const hazard of S.markers?.hazards || []) if (hazard.visible) {
      NEON.ring(c, hazard.x, hazard.y, 8 + hazard.scale * 12, 1.2, 'enemyAsteroid',
        { alpha: 0.34 + hazard.scale * 0.24, dash: [4, 7], dashOffset: S.t * 38, passes: 2 });
    }
    const progress = cl(S.route.distance / ROUTE_END, 0, 1), missionY = cl(H * 0.115, 82, 108), barW = cl(W * 0.24, 210, 340);
    NEON.text(c, S.phase === 'jump' ? 'SAUT INTERSECTORIEL' : objectiveText(),
      W / 2, missionY, S.phase === 'jump' ? 'combo' : 'ui', { size: cl(W * 0.014, 14, 20), align: 'center', alpha: 0.9, glowScale: 0.4 });
    NEON.line(c, W / 2 - barW / 2, missionY + 17, W / 2 + barW / 2, missionY + 17, 'ui', 2, { alpha: 0.15, passes: 1 });
    NEON.line(c, W / 2 - barW / 2, missionY + 17, W / 2 - barW / 2 + barW * progress, missionY + 17, 'player', 2.6, { alpha: 0.78, passes: 3 });
    NEON.text(c, Math.round(S.route.speed * 8.4) + ' km/s  ·  INTÉGRITÉ ' + ship.hull + '%', W / 2, missionY + 35,
      ship.hull < 35 ? 'danger' : 'ui', { size: 10, align: 'center', alpha: 0.68, glowScale: 0.22 });
    if (S.messageT > 0) NEON.text(c, S.message, W / 2, H * 0.25, 'ui',
      { size: cl(W * 0.021, 17, 29), align: 'center', alpha: cl(S.messageT, 0, 1), glowScale: 0.6 });
    if (S.t < 6.5) {
      const a = cl(S.t / 0.5, 0, 1) * cl((6.5 - S.t) / 1.1, 0, 1);
      NEON.text(c, 'FLÈCHES / ZQSD : DÉPLACEMENT   ·   ESPACE : TIR CONTINU', W / 2, H - 78,
        'ui', { size: cl(W * 0.0085, 9, 12), align: 'center', alpha: a * 0.76, glowScale: 0.22 });
    }
    if (S.route.warp > 0.12) {
      const a = cl(S.route.warp, 0, 1);
      NEON.text(c, 'HYPERESPACE', W / 2, H * 0.15, 'playerCore',
        { size: cl(W * 0.015, 14, 21), align: 'center', alpha: a * 0.72, glowScale: 0.7 });
      NEON.ring(c, W / 2, H / 2, Math.min(W, H) * (0.38 + a * 0.10), 1.2, 'player',
        { alpha: a * 0.16, dash: [18, 28], dashOffset: -S.t * 240, passes: 2 });
    }
  }

  function reset() { S.active = false; S.complete = false; S.shots.length = 0; S.enemyShots.length = 0; S.effects.length = 0; S.powerups.length = 0; }
  return { start, update, draw, reset, isActive: () => S.active, isComplete: () => S.active && S.complete, debug: () => S };
})();

window.TRANSIT = TRANSIT;
