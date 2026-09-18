import * as THREE from 'three';

/**
 * MENACE — la seconde caméra des stages 2D.
 *
 * Même stage, même simulation, même art : ce module ne fait que REGARDER la
 * scène 2D autrement. Le plan du jeu (x/y de la simulation) devient un plan
 * horizontal vu de derrière le vaisseau. Monter à l'écran, c'est aller vers
 * l'horizon.
 *
 * Rien n'est simulé ici : le module lit l'état du jeu, le projette, et rend un
 * canvas transparent que la scène 2D compose dans son propre pipeline NEON.
 * Les hitboxes, les dégâts et la progression restent donc EXACTEMENT ceux du
 * mode classique — c'est la promesse de la vue.
 *
 * L'art vient du jeu lui-même (`drawEnemyBillboard`, `drawXxxPlayerHull`) : on
 * ne redessine rien, on donne simplement de la profondeur aux mêmes tracés.
 */
const GAME3D = (() => {
  // Résolution des sprites : 192 px (taille de la poursuite) se lavait après
  // bloom en vue rapprochée. On rend plus grand, quitte à redimensionner.
  const SPRITE_PX = 512;
  const MAX_ENEMIES = 48;
  const MAX_SHOTS = 160;

  // --- placement de la caméra ------------------------------------------------
  // La caméra se place AU-DESSUS de la position du vaisseau dans le plan :
  // elle suit donc la profondeur sans jamais laisser le vaisseau sortir du
  // cadre. C'est ce qui rend les deux vues superposables sans rééquilibrage.
  // Champ serré : on veut des ennemis qui GROSSISSENT en approchant, pas une
  // étendue vide. Un FOV large tassait tout le terrain dans un coin.
  const CAM_HEIGHT_RATIO = 0.52;   // altitude = hauteur du canvas × ce ratio
  const CAM_BACK_RATIO = 0.62;     // recul derrière le vaisseau
  const FOV = 38;
  const HORIZON = 6000;            // distance du plan de fond

  // Le sol ne s'étend que sur la zone réellement survolée : un plan plus large
  // devenait un aplat laiteux qui noyait la scène dans le bloom.
  const GROUND_HALF_WIDTH = 2600;
  const GROUND_DEPTH = 15000;

  // Les vaisseaux joueur du contenu, par identifiant de rendu.
  const SHIP_RENDERERS = {
    'legacy-vector': 'drawClassicPlayerHull',
    'interceptor-vector': 'drawInterceptorPlayerHull',
    'bastion-vector': 'drawBastionPlayerHull'
  };

  const ENEMY_TYPES = ['normal', 'shooter', 'fast', 'armored', 'elite'];

  let renderer = null;
  let scene = null;
  let camera = null;
  let ground = null;
  let sky = null;
  let failed = false;
  let failureReason = null;
  let available = false;
  let width = 0;
  let height = 0;

  let shipSprite = null;
  let shipTextures = {};
  let enemySprites = [];
  let enemyTextures = {};
  let shotSprites = [];
  let shotTexture = null;
  const temp = new THREE.Vector3();

  function paletteColor(key, fallback) {
    try {
      const trip = PALETTE.get(key);
      return (trip && trip.glow) || fallback;
    } catch (e) { return fallback; }
  }

  /** Un canvas de sprite dessiné par l'ART DU JEU lui-même. */
  function spriteCanvas(draw) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SPRITE_PX;
    const context = canvas.getContext('2d');
    try { draw(context); } catch (e) { /* un sprite raté ne casse pas la vue */ }
    return canvas;
  }

  function textureFrom(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function buildShipTextures() {
    shipTextures = {};
    for (const type in SHIP_RENDERERS) {
      const fn = window[SHIP_RENDERERS[type]];
      if (typeof fn !== 'function') continue;
      shipTextures[type] = [];
      for (let frame = 0; frame < 4; frame++) {
        const canvas = spriteCanvas((context) => {
          // Le canvas est en pixels : l'art attend un repère centré, à
          // l'échelle du vaisseau 2D (40 × 22), donc on agrandit.
          const scale = SPRITE_PX / 64;
          context.save();
          context.translate(SPRITE_PX / 2, SPRITE_PX / 2);
          context.scale(scale, scale);
          fn(context, { alpha: 1, time: frame / 4, charge: 0.25 });
          context.restore();
        });
        shipTextures[type].push(textureFrom(canvas));
      }
    }
  }

  function buildEnemyTextures() {
    enemyTextures = {};
    if (typeof window.drawEnemyBillboard !== 'function') return;
    for (const type of ENEMY_TYPES) {
      enemyTextures[type] = [];
      for (let frame = 0; frame < 4; frame++) {
        const canvas = spriteCanvas((context) => {
          window.drawEnemyBillboard(context, type, SPRITE_PX, SPRITE_PX, frame / 4, type.length + frame * 0.7);
        });
        enemyTextures[type].push(textureFrom(canvas));
      }
    }
  }

  function buildShotTexture() {
    const canvas = spriteCanvas((context) => {
      const glow = paletteColor('bulletPlayer', '#7df9ff');
      const core = paletteColor('playerCore', '#ffffff');
      const c = SPRITE_PX / 2;
      const g = context.createRadialGradient(c, c, 0, c, c, SPRITE_PX * 0.5);
      g.addColorStop(0, core);
      g.addColorStop(0.25, glow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      context.fillStyle = g;
      context.fillRect(0, 0, SPRITE_PX, SPRITE_PX);
    });
    shotTexture = textureFrom(canvas);
  }

  /** Le sol : une grille discrète qui donne l'échelle et la profondeur. */
  function buildGround() {
    const grid = new THREE.GridHelper(GROUND_HALF_WIDTH * 2, 52,
      new THREE.Color(paletteColor('ui', '#3df5ff')),
      new THREE.Color(paletteColor('enemyShooter', '#2a4a66')));
    grid.material.transparent = true;
    grid.material.opacity = 0.12;
    grid.material.depthWrite = false;
    grid.scale.z = GROUND_DEPTH / (GROUND_HALF_WIDTH * 2);
    grid.position.set(0, -1, -GROUND_DEPTH * 0.5);
    scene.add(grid);
    ground = grid;

    // Un plan très sombre sous la grille : il donne un sol au vaisseau sans
    // éclaircir l'image. Toute la lumière doit venir des tracés néon.
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_HALF_WIDTH * 2, GROUND_DEPTH),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(paletteColor('bg', '#05060f')),
        transparent: true, opacity: 0.9, depthWrite: false
      })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, -1.5, -GROUND_DEPTH * 0.5);
    scene.add(plane);
  }

  /** PAS de ciel synthétique ici. Un plan de lueur, même discret, devenait
   *  après bloom une bande horizontale qui écrasait la scène. L'ambiance vient
   *  du décor 2D lui-même (planètes filaires, nébuleuses, poussière), déjà
   *  dessiné dans le tampon émissif : la vue n'a qu'à le laisser respirer. */
  function buildSky() { sky = null; }

  function init() {
    if (available) return true;
    if (failed) return false;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
      renderer.setClearAlpha(0);
      renderer.setPixelRatio(1);
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(FOV, 1, 1, HORIZON * 3);

      buildGround();
      buildSky();
      buildShipTextures();
      buildEnemyTextures();
      buildShotTexture();

      // -- vaisseau ----------------------------------------------------------
      shipSprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: shipTextures['legacy-vector'] ? shipTextures['legacy-vector'][0] : null,
        transparent: true, depthTest: false, depthWrite: false, toneMapped: false
      }));
      shipSprite.scale.set(64, 38, 1);
      shipSprite.renderOrder = 30;
      scene.add(shipSprite);

      // -- ennemis -----------------------------------------------------------
      for (let i = 0; i < MAX_ENEMIES; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          transparent: true, depthTest: false, depthWrite: false, toneMapped: false
        }));
        sprite.visible = false;
        sprite.renderOrder = 20;
        scene.add(sprite);
        enemySprites.push(sprite);
      }

      // -- projectiles du joueur --------------------------------------------
      for (let i = 0; i < MAX_SHOTS; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: shotTexture, transparent: true, depthTest: false, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false
        }));
        sprite.visible = false;
        sprite.renderOrder = 25;
        scene.add(sprite);
        shotSprites.push(sprite);
      }

      available = true;
      return true;
    } catch (error) {
      failed = true;
      failureReason = (error && error.message) ? error.message : String(error);
      console.info('GAME3D : repli sur la vue classique —', failureReason);
      return false;
    }
  }

  function resize(w, h) {
    if (!init()) return;
    if (w === width && h === height) return;
    width = w; height = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  /** Une frame d'animation lisible : l'art 2D attend un temps normalisé. */
  function animFrame(speed) {
    const t = (typeof FRAME !== 'undefined' && FRAME && typeof FRAME.time === 'number') ? FRAME.time : 0;
    return Math.floor((t * (speed || 8)) % 4) % 4;
  }

  function setSpriteFrame(sprite, textures, frame) {
    if (!textures || !textures.length) return;
    const material = sprite.material;
    const wanted = textures[frame] || textures[0];
    if (material.map !== wanted) { material.map = wanted; material.needsUpdate = true; }
  }

  /**
   * Compose la vue. `snapshot` porte l'état du stage 2D :
   *   { player, enemies, playerBullets, shipRenderer }
   * @returns {{canvas: HTMLCanvasElement, markers: object}|null}
   */
  function frame(snapshot, w, h) {
    if (!init()) return null;
    // `resize()` sort tôt si la taille n'a pas changé : on la force ici, car
    // `init()` peut avoir été appelé avant que `resize()` n'ait posé la
    // moindre dimension. Sans cela le rendu restait dans un canvas par défaut.
    width = -1; height = -1;
    resize(w, h);
    if (!snapshot) return null;

    const planeX = (x) => x - w / 2;
    const planeZ = (y) => y - h / 2;
    const player = snapshot.player || { x: w / 2, y: h * 0.85, width: 40, height: 22 };
    const px = planeX(player.x + (player.width || 40) / 2);
    const pz = planeZ(player.y + (player.height || 22) / 2);

    // --- caméra : au-dessus du vaisseau, qui regarde vers l'horizon --------
    const camHeight = h * CAM_HEIGHT_RATIO;
    // On recule d'une distance FIXE, indépendante de la taille du canvas : la
    // profondeur perçue ne doit pas changer avec la fenêtre.
    const camBack = Math.max(520, h * CAM_BACK_RATIO);
    camera.position.set(px, camHeight, pz + camBack);
    camera.lookAt(px, 0, pz - h * 0.22);

    // --- vaisseau ---------------------------------------------------------
    const rendererKey = snapshot.shipRenderer || 'legacy-vector';
    const hullTextures = shipTextures[rendererKey] || shipTextures['legacy-vector'];
    if (shipSprite) {
      shipSprite.visible = true;
      shipSprite.position.set(px, 0, pz);
      setSpriteFrame(shipSprite, hullTextures, animFrame(6));
      const blink = (player.invulnerable && player.blink) ? 0.35 : 1;
      shipSprite.material.opacity = blink;
    }

    // --- ennemis ----------------------------------------------------------
    const enemies = snapshot.enemies || [];
    let used = 0;
    for (let i = 0; i < enemies.length && used < enemySprites.length; i++) {
      const e = enemies[i];
      if (!e || e.isDeleted) continue;
      const sprite = enemySprites[used++];
      // Le sprite suit la taille réelle de l'ennemi, avec une marge : à cette
      // distance, un sprite à l'échelle exacte devenait illisible.
      const size = Math.max(34, Math.max(e.width || 32, e.height || 32) * 1.5);
      sprite.visible = true;
      sprite.position.set(planeX(e.x + (e.width || 0) / 2), 0, planeZ(e.y + (e.height || 0) / 2));
      sprite.scale.set(size, size, 1);
      setSpriteFrame(sprite, enemyTextures[e.type] || enemyTextures.normal, animFrame(8));
      sprite.material.opacity = e.hitFlash > 0 ? 1 : 0.96;
    }
    for (let i = used; i < enemySprites.length; i++) enemySprites[i].visible = false;

    // --- projectiles du joueur -------------------------------------------
    const bullets = snapshot.playerBullets || [];
    let shot = 0;
    for (let i = 0; i < bullets.length && shot < shotSprites.length; i++) {
      const b = bullets[i];
      if (!b) continue;
      const sprite = shotSprites[shot++];
      sprite.visible = true;
      sprite.position.set(planeX(b.x + (b.width || 0) / 2), 2, planeZ(b.y + (b.height || 0) / 2));
      const s = Math.max(10, (b.width || 3) * 6);
      sprite.scale.set(s, s * 2.6, 1);
    }
    for (let i = shot; i < shotSprites.length; i++) shotSprites[i].visible = false;

    renderer.render(scene, camera);

    // --- marqueurs écran, pour que game.js trace les mêmes tracés néon -----
    const aim = new THREE.Vector3();
    const toScreen = (x, y) => {
      aim.set(x, y, 0).project(camera);
      return { x: (aim.x * 0.5 + 0.5) * w, y: (-aim.y * 0.5 + 0.5) * h };
    };
    const shipMarker = toScreen(px, 0);
    const enemyMarkers = [];
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e || e.isDeleted) continue;
      const p = toScreen(planeX(e.x + (e.width || 0) / 2), 0);
      enemyMarkers.push({ x: p.x, y: p.y + 2 });
    }

    return {
      canvas: renderer.domElement,
      markers: {
        ship: { x: shipMarker.x, y: shipMarker.y, visible: true },
        enemies: enemyMarkers
      }
    };
  }

  return {
    frame,
    isAvailable: () => init(),
    /** Dimensions réelles du rendu — sert au diagnostic de cadrage. */
    debug: () => (renderer ? { width: renderer.domElement.width, height: renderer.domElement.height } : null),
    /** Raison d'un éventuel repli, pour l'annoncer plutôt que de la subir. */
    failureReason: () => failureReason,
    reset() { /* rien à réinitialiser : la vue ne possède aucun état de jeu */ }
  };
})();

window.GAME3D = GAME3D;
