import * as THREE from 'three';
import { SPACE_LOOKS } from './space3d.js';

/** Vue poursuite 3D du transit. Toute collision demeure dans modes/transit.js. */
const TRANSIT3D = (() => {
  const MAX_PIXELS = 1_050_000;
  const STAR_COUNT = 1500;
  const STREAK_COUNT = 340;
  const THEMES = [
    ['#02070d', '#3ca7c6', '#d49b5c'], ['#0b0308', '#c83d55', '#ff9a52'],
    ['#04050f', '#666fd0', '#83c8e5'], ['#0d0703', '#d36e32', '#f4c25d'],
    ['#020b08', '#36a781', '#8edcbe'], ['#08030c', '#8a55bb', '#df8054']
  ];
  const SHIP_FORMS = {
    classic: {
      hull: [[0,-14],[4.5,-4],[19,9],[9,6],[6.5,11],[0,6.5],[-6.5,11],[-9,6],[-19,9],[-4.5,-4]],
      cockpit: [[0,-9],[3.2,-2],[0,4],[-3.2,-2]], engines: [-6.5, 6.5], engineZ: 9.5,
      details: [[[-11,3.5],[-11,9.5]],[[11,3.5],[11,9.5]],[[-4.5,-4],[4.5,-4]]]
    },
    interceptor: {
      hull: [[0,-18],[5,-4],[18,10],[4,6],[0,13],[-4,6],[-18,10],[-5,-4]],
      cockpit: [[0,-13],[3,-3],[0,6],[-3,-3]], engines: [-4, 4], engineZ: 8,
      details: [[[0,-14],[0,8]],[[-10,5],[-3,2]],[[10,5],[3,2]]]
    },
    bastion: {
      hull: [[0,-14],[9,-6],[22,3],[18,12],[7,9],[0,14],[-7,9],[-18,12],[-22,3],[-9,-6]],
      cockpit: [[0,-8],[5,-2],[4,5],[0,8],[-4,5],[-5,-2]], engines: [-8, 0, 8], engineZ: 10,
      details: [[[-13,3],[13,3]],[[-8,-5],[-8,8]],[[8,-5],[8,8]]]
    }
  };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const resources = [];
  const tmp = new THREE.Object3D();
  const vec = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  let renderer, scene, camera, world, ship, engineMaterial, hullMaterial;
  let stars, streaks, streakData, asteroidInstances, asteroidWireInstances, enemySprites, enemySpriteMaterials, powerupSprites, powerupSpriteMaterials;
  let playerShotHeads, enemyShotHeads;
  let celestials = [];
  let playerShots, enemyShots, effects, effectBursts, warpRings, warpMaterial;
  let width = 0, height = 0, themeIndex = -1, shipId = '', lastFrame = -1, available = false, failed = false;
  const cameraPosition = new THREE.Vector3(0, 12, 42);
  const lookPosition = new THREE.Vector3(0, 2, -50);

  function track(value) { resources.push(value); return value; }
  function material(options) { return track(new THREE.MeshPhysicalMaterial(options)); }
  function mesh(geometry, mat, parent = world) {
    const value = new THREE.Mesh(track(geometry), mat); parent.add(value); return value;
  }

  function init() {
    if (renderer || failed) return available;
    try {
      const canvas = document.createElement('canvas');
      if (!canvas.getContext('webgl2')) throw new Error('WebGL 2 indisponible');
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); available = false; failed = true; });
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x02070d, 0.00034);
      camera = new THREE.PerspectiveCamera(61, 1, 0.3, 9000);
      scene.add(new THREE.HemisphereLight(0x86b3c4, 0x09030b, 0.75));
      const key = new THREE.DirectionalLight(0xffdec4, 3.8);
      key.position.set(-3, 5, 4); scene.add(key);
      const rim = new THREE.PointLight(0x46dfff, 90, 180, 2);
      rim.position.set(0, 8, 16); camera.add(rim); scene.add(camera);
      available = true;
    } catch (error) {
      failed = true; console.info('TRANSIT3D : repli Canvas —', error?.message || error);
    }
    return available;
  }

  function disposeWorld() {
    if (world) scene.remove(world);
    for (const value of resources.splice(0)) { try { value.dispose?.(); } catch (_) { /* libérée */ } }
    world = null; celestials = [];
  }

  function seeded(seed) {
    let value = (seed | 0) || 1;
    return () => { value += 0x6d2b79f5; let t = value; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }

  function build(theme, selectedShip) {
    disposeWorld(); themeIndex = theme; shipId = selectedShip; world = new THREE.Group(); scene.add(world);
    const colors = THEMES[theme % THEMES.length];
    renderer.setClearColor(colors[0], 1); scene.fog.color.set(colors[0]);
    const random = seeded(theme + 73);

    // Champ profond : points fins, non émissifs, pour garder les menaces rouges lisibles.
    const starData = new Float32Array(STAR_COUNT * 3);
    const starColors = new Float32Array(STAR_COUNT * 3);
    const cold = new THREE.Color(colors[1]), warm = new THREE.Color(colors[2]), white = new THREE.Color('#dce9e8');
    for (let i = 0; i < STAR_COUNT; i++) {
      const p = i * 3;
      starData[p] = (random() - 0.5) * 9000;
      starData[p + 1] = (random() - 0.5) * 5200;
      starData[p + 2] = 900 - random() * 8200;
      const color = (i % 13 === 0 ? warm : cold).clone().lerp(white, 0.35 + random() * 0.55);
      starColors[p] = color.r; starColors[p + 1] = color.g; starColors[p + 2] = color.b;
    }
    const starGeometry = track(new THREE.BufferGeometry());
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starData, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
    stars = new THREE.Points(starGeometry, track(new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.80 })));
    world.add(stars);

    // Traits de proximité attachés au cap du vaisseau : leur longueur traduit la vitesse.
    streakData = new Float32Array(STREAK_COUNT * 6);
    for (let i = 0; i < STREAK_COUNT; i++) resetStreak(i, random, true);
    const streakGeometry = track(new THREE.BufferGeometry());
    streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakData, 3));
    streaks = new THREE.LineSegments(streakGeometry, track(new THREE.LineBasicMaterial({ color: colors[1], transparent: true, opacity: 0.28 })));
    world.add(streaks);

    buildShip(colors, selectedShip);
    buildPools(colors);
    buildScenery(colors, theme);
  }

  function extrudedForm(points, depth, bevel) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geometry = track(new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, bevelEnabled: true, bevelSegments: 2,
      bevelSize: bevel, bevelThickness: bevel
    }));
    // Le tracé 2D original est en X/Y. On conserve X et transforme Y en Z :
    // le nez historique (Y négatif) pointe ainsi bien vers l'avant (-Z).
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, depth * 0.5, 0);
    return geometry;
  }

  function beam(parent, a, b, radius, mat, height = 2.25) {
    const start = new THREE.Vector3(a[0], height, a[1]);
    const end = new THREE.Vector3(b[0], height, b[1]);
    const delta = end.clone().sub(start);
    const object = mesh(new THREE.CylinderGeometry(radius, radius, delta.length(), 6), mat, parent);
    object.position.copy(start).add(end).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return object;
  }

  function buildShip(colors, selectedShip) {
    const form = SHIP_FORMS[selectedShip] || SHIP_FORMS.classic;
    ship = new THREE.Group(); world.add(ship);
    hullMaterial = material({
      color: '#07171d', metalness: 0.66, roughness: 0.24,
      transparent: true, opacity: 0.80, emissive: '#0a4853', emissiveIntensity: 0.22,
      clearcoat: 0.72, clearcoatRoughness: 0.18
    });
    const playerGlow = track(new THREE.MeshBasicMaterial({
      color: '#3df5ff', transparent: true, opacity: 0.86,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    const coreGlow = track(new THREE.MeshBasicMaterial({
      color: '#d9ffff', transparent: true, opacity: 0.94,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    const canopyMaterial = material({
      color: '#071f31', metalness: 0.22, roughness: 0.09,
      transparent: true, opacity: 0.88, emissive: '#3df5ff', emissiveIntensity: 0.30,
      clearcoat: 1, clearcoatRoughness: 0.05
    });
    engineMaterial = track(new THREE.MeshBasicMaterial({
      color: '#ff9d3d', transparent: true, opacity: 0.82,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));
    const engineCoreMaterial = track(new THREE.MeshBasicMaterial({
      color: '#fff3d6', transparent: true, opacity: 0.92,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    }));

    const hullGeometry = extrudedForm(form.hull, 3.8, 0.65);
    const hull = new THREE.Mesh(hullGeometry, hullMaterial); ship.add(hull);
    const hullEdges = new THREE.LineSegments(track(new THREE.EdgesGeometry(hullGeometry, 18)), playerGlow);
    ship.add(hullEdges);
    // Le contour supérieur reprend point pour point le sprite Canvas, mais avec
    // une véritable épaisseur lumineuse visible en caméra oblique.
    for (let i = 0; i < form.hull.length; i++) {
      beam(ship, form.hull[i], form.hull[(i + 1) % form.hull.length], 0.24, playerGlow);
    }

    const cockpitGeometry = extrudedForm(form.cockpit, 2.0, 0.42);
    cockpitGeometry.translate(0, 2.4, 0);
    const cockpit = new THREE.Mesh(cockpitGeometry, canopyMaterial); ship.add(cockpit);
    ship.add(new THREE.LineSegments(track(new THREE.EdgesGeometry(cockpitGeometry, 15)), coreGlow));
    for (const line of form.details) beam(ship, line[0], line[1], 0.15, coreGlow, 2.42);

    const engineShell = material({ color: '#092d35', metalness: 0.72, roughness: 0.22, emissive: '#3df5ff', emissiveIntensity: 0.24 });
    for (const x of form.engines) {
      const ring = mesh(new THREE.TorusGeometry(1.28, 0.28, 7, 18), playerGlow, ship);
      ring.position.set(x, -0.1, form.engineZ);
      const flame = mesh(new THREE.ConeGeometry(1.02, 13, 10, 1, true), engineMaterial, ship);
      flame.rotation.x = Math.PI / 2; flame.position.set(x, -0.1, form.engineZ + 7.2); flame.userData.engine = true;
      const coreFlame = mesh(new THREE.ConeGeometry(0.42, 8.5, 8, 1, true), engineCoreMaterial, ship);
      coreFlame.rotation.x = Math.PI / 2; coreFlame.position.set(x, -0.1, form.engineZ + 5.0);
      coreFlame.userData.engineCore = true;
      const nacelle = mesh(new THREE.CylinderGeometry(1.12, 1.28, 3.7, 10), engineShell, ship);
      nacelle.rotation.x = Math.PI / 2; nacelle.position.set(x, -0.1, form.engineZ - 1.2);
    }
    const reactorLight = new THREE.PointLight(0xffa13d, 46, 90, 2);
    reactorLight.position.set(0, 2, form.engineZ + 5); ship.add(reactorLight);
    const muzzleMaterial = track(new THREE.MeshBasicMaterial({ color: '#d9ffff', transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const muzzle = mesh(new THREE.ConeGeometry(1.8, 10, 8, 1, true), muzzleMaterial, ship);
    muzzle.rotation.x = -Math.PI / 2;
    muzzle.position.set(0, 1.4, Math.min(...form.hull.map((point) => point[1])) - 5);
    muzzle.userData.muzzle = true;
    const maxX = Math.max(...form.hull.map((point) => Math.abs(point[0])));
    for (const side of [-1, 1]) {
      const rcsMaterial = track(new THREE.MeshBasicMaterial({ color: '#ffc247', transparent: true,
        opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      const rcs = mesh(new THREE.SphereGeometry(0.9, 7, 5), rcsMaterial, ship);
      rcs.position.set(side * maxX * 0.92, 0.7, 4); rcs.userData.rcsSide = side;
    }
    ship.userData.baseScale = selectedShip === 'bastion' ? 0.53 : (selectedShip === 'interceptor' ? 0.57 : 0.58);
    ship.scale.setScalar(ship.userData.baseScale);
    // Le décor peut longer la trajectoire mais ne doit jamais effacer le
    // joueur. Cette priorité reproduit l'ordre de calques strict du Canvas 2D.
    ship.traverse((object) => {
      object.renderOrder = 30;
      if (object.material) { object.material.depthTest = false; object.material.depthWrite = false; }
    });
  }

  function buildPools(colors) {
    const rockGeometry = track(new THREE.IcosahedronGeometry(1, 2));
    const rockPosition = rockGeometry.attributes.position;
    for (let i = 0; i < rockPosition.count; i++) {
      const x = rockPosition.getX(i), y = rockPosition.getY(i), z = rockPosition.getZ(i);
      const noise = 0.78 + ((Math.sin(x * 17.3 + y * 31.7 + z * 47.1) + 1) * 0.11);
      rockPosition.setXYZ(i, x * noise, y * noise * 0.82, z * noise * 1.12);
    }
    rockGeometry.computeVertexNormals();
    const rockMaterial = material({ color: '#272b37', metalness: 0.05, roughness: 0.94, emissive: '#121621', emissiveIntensity: 0.10 });
    asteroidInstances = new THREE.InstancedMesh(rockGeometry, rockMaterial, 12); world.add(asteroidInstances);
    asteroidWireInstances = new THREE.InstancedMesh(rockGeometry, track(new THREE.MeshBasicMaterial({
      color: '#8b91a0', wireframe: true, transparent: true, opacity: 0.13, depthWrite: false
    })), 12); world.add(asteroidWireInstances);

    enemySpriteMaterials = {};
    for (const type of ['normal', 'shooter', 'fast', 'armored', 'elite']) {
      enemySpriteMaterials[type] = [];
      for (let frame = 0; frame < 4; frame++) {
        const cv = document.createElement('canvas'); cv.width = cv.height = 192;
        const context = cv.getContext('2d');
        if (window.drawEnemyBillboard) window.drawEnemyBillboard(context, type, 192, 192, frame / 4, type.length + frame * 0.7);
        const texture = track(new THREE.CanvasTexture(cv)); texture.colorSpace = THREE.SRGBColorSpace;
        enemySpriteMaterials[type].push(track(new THREE.SpriteMaterial({ map: texture, transparent: true,
          depthTest: false, depthWrite: false, alphaTest: 0.015, toneMapped: false })));
      }
    }
    enemySprites = [];
    for (let i = 0; i < 40; i++) {
      const sprite = new THREE.Sprite(enemySpriteMaterials.normal[0]); sprite.visible = false; sprite.renderOrder = 20;
      sprite.center.set(0.5, 0.5); world.add(sprite); enemySprites.push(sprite);
    }
    playerShots = linesPool(128, '#4dd2ff', 0.98);
    enemyShots = linesPool(96, '#ff2b55', 0.98);
    playerShotHeads = projectilePoints(128, projectileTexture('player'), 5.2);
    enemyShotHeads = projectilePoints(96, projectileTexture('enemy'), 6.0);
    world.add(playerShotHeads, enemyShotHeads);
    powerupSpriteMaterials = {};
    const powerTypes = (window.POWERUP_TYPES || []).map((item) => item.key);
    if (!powerTypes.length) powerTypes.push('double', 'spread', 'mitraille', 'bouclier');
    for (const type of powerTypes) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 160;
      const context = cv.getContext('2d');
      if (window.drawPowerUpBillboard) window.drawPowerUpBillboard(context, type, 160, 160, 0);
      const texture = track(new THREE.CanvasTexture(cv)); texture.colorSpace = THREE.SRGBColorSpace;
      powerupSpriteMaterials[type] = track(new THREE.SpriteMaterial({ map: texture, transparent: true,
        depthTest: false, depthWrite: false, alphaTest: 0.01, toneMapped: false }));
    }
    powerupSprites = [];
    for (let i = 0; i < 14; i++) {
      const sprite = new THREE.Sprite(powerupSpriteMaterials.double); sprite.visible = false; sprite.renderOrder = 25;
      world.add(sprite); powerupSprites.push(sprite);
    }
    effects = new THREE.Group(); world.add(effects);
    for (let i = 0; i < 36; i++) {
      const ring = mesh(new THREE.TorusGeometry(1, 0.10, 6, 24), track(new THREE.MeshBasicMaterial({ color: i % 2 ? colors[2] : '#ff435c', transparent: true, opacity: 0 })), effects);
      ring.visible = false;
    }
    const burstGeometry = track(new THREE.BufferGeometry());
    burstGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36 * 7 * 6), 3));
    burstGeometry.setDrawRange(0, 0);
    effectBursts = new THREE.LineSegments(burstGeometry, track(new THREE.LineBasicMaterial({
      color: '#ff7a2b', transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending, depthWrite: false
    })));
    world.add(effectBursts);
    warpRings = new THREE.Group(); world.add(warpRings);
    warpMaterial = track(new THREE.MeshBasicMaterial({ color: '#a8fbff', transparent: true,
      opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    for (let i = 0; i < 14; i++) {
      const ring = mesh(new THREE.TorusGeometry(76 + (i % 3) * 7, 0.32 + (i % 2) * 0.18, 5, 72), warpMaterial, warpRings);
      ring.userData.warpIndex = i;
    }
  }

  function linesPool(count, color, opacity) {
    const geometry = track(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 6), 3));
    geometry.setDrawRange(0, 0);
    const lines = new THREE.LineSegments(geometry, track(new THREE.LineBasicMaterial({ color, transparent: true, opacity })));
    world.add(lines); return lines;
  }

  function projectileTexture(owner) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 96;
    const c = cv.getContext('2d'), neon = window.NEON;
    if (owner === 'player') {
      neon.line(c, 48, 84, 48, 49, 'bulletPlayer', 4.2, { alpha: 0.34, passes: 3, composite: 'lighter' });
      neon.beam(c, 43, 19, 10, 38, 'bulletPlayer', { alpha: 1, glowScale: 1.0, passes: 4, composite: 'lighter' });
      neon.line(c, 48, 23, 48, 51, 'playerCore', 1.6, { alpha: 1, passes: 2, halo: false, composite: 'lighter' });
    } else {
      neon.shape(c, [48,18, 67,48, 48,78, 29,48], 'bulletEnemy', 4, { alpha: 1, fill: true, fillAlpha: 0.34, passes: 4, composite: 'lighter' });
      neon.ring(c, 48, 48, 27, 2.3, 'bulletEnemy', { alpha: 0.42, dash: [5,6], passes: 3 });
      neon.dot(c, 48, 48, 5, 'bulletEnemy', { alpha: 1, glowScale: 0.9, composite: 'lighter' });
    }
    const texture = track(new THREE.CanvasTexture(cv)); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function projectilePoints(count, map, size) {
    const geometry = track(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setDrawRange(0, 0);
    return new THREE.Points(geometry, track(new THREE.PointsMaterial({ map, size, sizeAttenuation: true,
      transparent: true, alphaTest: 0.015, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })));
  }

  function mixHex(a, b, amount) {
    return '#' + new THREE.Color(a).lerp(new THREE.Color(b), amount).getHexString();
  }

  function surfaceTexture(look, seed) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const c = cv.getContext('2d'), random = seeded(seed * 9173 + 41);
    const base = c.createLinearGradient(0, 0, 0, cv.height);
    base.addColorStop(0, mixHex(look.base, look.light, 0.16));
    base.addColorStop(0.48, look.base); base.addColorStop(1, mixHex(look.base, '#02030a', 0.48));
    c.fillStyle = base; c.fillRect(0, 0, cv.width, cv.height);
    const rows = look.bands * 3;
    for (let i = 0; i < rows; i++) {
      const y = (i + random()) / rows * cv.height, thick = 2 + random() * cv.height / rows * 1.6;
      c.globalAlpha = 0.05 + random() * 0.17; c.fillStyle = random() > 0.72 ? look.accent : look.light;
      c.beginPath(); c.moveTo(0, y);
      for (let x = 0; x <= cv.width; x += 16) c.lineTo(x, y + Math.sin(x * 0.025 + i * 1.7) * thick * 0.55 + (random() - 0.5) * thick);
      c.lineTo(cv.width, y + thick); c.lineTo(0, y + thick); c.closePath(); c.fill();
    }
    if (look.kind === 'volcanic' || look.kind === 'shattered') {
      c.globalCompositeOperation = 'screen';
      for (let i = 0; i < 42; i++) {
        const x = random() * cv.width, y = random() * cv.height;
        c.strokeStyle = look.accent; c.globalAlpha = 0.12 + random() * 0.34;
        c.lineWidth = 0.7 + random() * 1.6; c.beginPath(); c.moveTo(x, y);
        for (let j = 1; j < 5; j++) c.lineTo(x + (random() - 0.45) * j * 15, y + j * (4 + random() * 8));
        c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
    } else if (look.kind !== 'gas' && look.kind !== 'sun') {
      for (let i = 0; i < 70; i++) {
        const r = 1 + random() * random() * 11; c.globalAlpha = 0.04 + random() * 0.10;
        c.fillStyle = random() > 0.5 ? look.light : '#02030a'; c.beginPath();
        c.ellipse(random() * cv.width, random() * cv.height, r * 1.8, r, random(), 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = 1;
    const texture = track(new THREE.CanvasTexture(cv)); texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping; texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function reliefTexture(look, seed) {
    const w = 256, h = 128, data = new Uint8Array(w * h), random = seeded(seed * 1259 + 73);
    const p1 = random() * Math.PI * 2, p2 = random() * Math.PI * 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = x / w * Math.PI * 2, ny = y / h * Math.PI;
      const bands = Math.sin(ny * look.bands + Math.sin(nx * 2 + p1) * 0.72) * 34;
      const broad = Math.sin(nx * 3 + ny * 5 + p2) * 20;
      const grain = (random() - 0.5) * (look.kind === 'gas' || look.kind === 'sun' ? 20 : 54);
      data[y * w + x] = Math.max(0, Math.min(255, 128 + bands + broad + grain));
    }
    const texture = track(new THREE.DataTexture(data, w, h, THREE.RedFormat));
    texture.wrapS = THREE.RepeatWrapping; texture.needsUpdate = true; return texture;
  }

  function atmosphere(color, radius, strength) {
    return new THREE.Mesh(track(new THREE.SphereGeometry(radius, 36, 24)), track(new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { glowColor: { value: new THREE.Color(color) }, strength: { value: strength } },
      vertexShader: `varying vec3 vN; varying vec3 vV; void main(){vec4 w=modelMatrix*vec4(position,1.);vN=normalize(mat3(modelMatrix)*normal);vV=normalize(cameraPosition-w.xyz);gl_Position=projectionMatrix*viewMatrix*w;}`,
      fragmentShader: `varying vec3 vN; varying vec3 vV; uniform vec3 glowColor; uniform float strength; void main(){float f=pow(1.-max(0.,dot(vN,vV)),2.4);gl_FragColor=vec4(glowColor,f*strength);}`
    })));
  }

  function planetSphere(look, seed, radius) {
    return new THREE.Mesh(track(look.kind === 'crystal'
      ? new THREE.IcosahedronGeometry(radius, 3) : new THREE.SphereGeometry(radius, 44, 28)),
    material({ map: surfaceTexture(look, seed), bumpMap: reliefTexture(look, seed),
      bumpScale: look.kind === 'gas' || look.kind === 'sun' ? 0.018 : 0.045,
      color: '#ffffff', roughness: look.roughness,
      metalness: look.kind === 'crystal' ? 0.28 : 0.04, flatShading: look.kind === 'crystal',
      emissive: look.kind === 'sun' || look.kind === 'volcanic' ? look.accent : '#000000',
      emissiveIntensity: look.kind === 'sun' ? 0.32 : (look.kind === 'volcanic' ? 0.11 : 0) }));
  }

  function celestialBody(look, seed, radius) {
    const group = new THREE.Group();
    if (look.kind === 'blackhole') {
      group.add(new THREE.Mesh(track(new THREE.SphereGeometry(radius * 0.72, 40, 28)), material({ color: '#010104' })));
      const disk = track(new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0.56, side: THREE.DoubleSide, depthWrite: false }));
      for (let i = 0; i < 5; i++) {
        const ring = new THREE.Mesh(track(new THREE.TorusGeometry(radius * (1 + i * 0.16), radius * (0.055 + i * 0.012), 8, 96)), disk);
        ring.rotation.x = Math.PI * (0.42 + i * 0.008); ring.rotation.z = -0.22; ring.userData.celestialRing = i; group.add(ring);
      }
      group.add(atmosphere(look.atmosphere, radius * 1.12, 0.42));
    } else if (look.kind === 'binary') {
      const other = { ...look, base: look.accent, light: '#ffd0a8', accent: look.light };
      const a = planetSphere(look, seed, radius * 0.67), b = planetSphere(other, seed + 1, radius * 0.48);
      a.position.set(-radius * 0.58, radius * 0.16, 0); b.position.set(radius * 0.70, -radius * 0.18, radius * 0.18);
      group.add(a, b, atmosphere(look.atmosphere, radius * 1.42, 0.22));
    } else {
      group.add(planetSphere(look, seed, radius));
      group.add(atmosphere(look.atmosphere, radius * 1.07, look.kind === 'sun' ? 0.48 : 0.30));
      if (look.kind === 'ringed' || look.kind === 'gas' || look.kind === 'ocean') {
        const ring = new THREE.Mesh(track(new THREE.RingGeometry(radius * 1.28, radius * (look.kind === 'ringed' ? 2.15 : 1.82), 96)),
          track(new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })));
        ring.rotation.x = Math.PI * 0.43; ring.rotation.z = -0.18; group.add(ring);
      }
    }
    return group;
  }

  function buildScenery(colors, theme) {
    const look = SPACE_LOOKS[theme % SPACE_LOOKS.length];
    const body = celestialBody(look, theme + 1, 520);
    // Le corps principal est réellement longé : il traverse la profondeur du
    // rail, largement hors de l'axe de combat afin de ne jamais masquer les tirs.
    body.position.set(theme % 2 ? -760 : 760, -270, -4200); body.rotation.z = 0.08;
    body.userData.celestial = true; body.userData.routeAt = 7600; body.userData.routeScale = 0.55;
    world.add(body); celestials.push(body);
    const moonLook = { ...look, kind: 'moon', base: mixHex(look.base, '#6b7488', 0.55), light: '#aeb8c8', accent: look.light, bands: 3, roughness: 1 };
    const moon = planetSphere(moonLook, theme + 31, 125);
    moon.position.set(theme % 2 ? 420 : -430, 230, -3200);
    moon.userData.celestial = true; moon.userData.moon = true;
    moon.userData.routeAt = 15300; moon.userData.routeScale = 0.62;
    world.add(moon); celestials.push(moon);
  }

  function resetStreak(i, random = Math.random, initial = false) {
    const p = i * 6, a = random() * Math.PI * 2, r = 35 + Math.pow(random(), 0.55) * 360;
    const z = initial ? 100 - random() * 1100 : -1000 - random() * 160;
    streakData[p] = Math.cos(a) * r; streakData[p + 1] = Math.sin(a) * r; streakData[p + 2] = z;
    streakData[p + 3] = streakData[p]; streakData[p + 4] = streakData[p + 1]; streakData[p + 5] = z - 2;
  }

  function resize(w, h) {
    if (w === width && h === height) return;
    width = Math.max(1, w); height = Math.max(1, h);
    const scale = Math.min(0.88, Math.max(0.54, Math.sqrt(MAX_PIXELS / (width * height))));
    renderer.setSize(Math.round(width * scale), Math.round(height * scale), false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
  }

  function updateShip(state, dt) {
    const s = state.ship;
    const route = state.route;
    // Caméra centrale : les commandes déplacent uniquement la coque dans le
    // cadre. Le très léger cap ci-dessous appartient à la trajectoire imposée.
    ship.position.set(s.x, s.y, s.kick * 2.6);
    // Le nez reste strictement sur l'axe réel des canons. Les sensations de
    // pilotage passent par le roulis, sans faire croire à une visée différente.
    ship.rotation.set(-0.025, 0, s.roll + route.roll, 'YXZ');
    ship.scale.setScalar(ship.userData.baseScale * (1 + s.kick * 0.018));
    ship.visible = s.invuln <= 0 || Math.floor(state.t * 12) % 2 === 0;
    const warpEnergy = Math.max(0, Math.min(1, (route.speed - 360) / 760));
    for (const child of ship.children) if (child.userData.engine) {
      child.scale.y = (0.68 + warpEnergy * 2.25) * (0.90 + Math.sin(state.t * 52) * 0.10);
      engineMaterial.opacity = 0.66 + warpEnergy * 0.28;
    }
    for (const child of ship.children) if (child.userData.engineCore) {
      child.scale.y = (0.72 + warpEnergy * 1.72) * (0.94 + Math.sin(state.t * 61 + 1) * 0.06);
    }
    for (const child of ship.children) if (child.userData.muzzle) {
      child.visible = s.muzzle > 0.02; child.material.opacity = s.muzzle * 0.95;
      child.scale.set(0.65 + s.muzzle * 0.65, 0.7 + s.muzzle * 1.35, 0.65 + s.muzzle * 0.65);
    }
    for (const child of ship.children) if (child.userData.rcsSide) {
      const active = s.inputX && child.userData.rcsSide === -s.inputX;
      child.material.opacity = active ? 0.42 + Math.sin(state.t * 48) * 0.16 : 0;
      child.scale.setScalar(active ? 1.3 + Math.abs(Math.sin(state.t * 37)) * 1.1 : 0.2);
    }
    const shake = reduced ? 0 : route.warp * 0.65;
    cameraPosition.set(Math.sin(state.t * 43) * shake, 12 + Math.sin(state.t * 37) * shake, 68);
    // L'axe de combat ne suit pas le point de fuite du décor. Quand X/Y
    // reprenaient curveX/curveY, la caméra regardait ailleurs tandis que les
    // collisions continuaient sur -Z : viseur et traînées partaient alors
    // jusqu'au coin supérieur gauche. La courbe reste portée par le roulis,
    // les astres et les streaks, jamais par la visée.
    lookPosition.set(0, 0, -135);
    camera.position.copy(cameraPosition);
    camera.up.set(Math.sin(route.roll), Math.cos(route.roll), 0).normalize();
    camera.lookAt(lookPosition);
    const wantedFov = 59 + warpEnergy * 14 + (state.phase === 'jump' ? 12 : 0);
    camera.fov += (wantedFov - camera.fov) * Math.min(1, dt * 3.8); camera.updateProjectionMatrix();
  }

  function updateStreaks(state, dt) {
    streaks.position.set(0, 0, 0); streaks.rotation.set(0, 0, state.route.roll);
    const localSpeed = reduced ? 110 : state.route.speed;
    const length = 3 + Math.max(0, localSpeed - 180) * 0.11;
    for (let i = 0; i < STREAK_COUNT; i++) {
      const p = i * 6; streakData[p + 2] += localSpeed * dt * 1.15;
      if (streakData[p + 2] > 120) resetStreak(i);
      streakData[p + 5] = streakData[p + 2] - length;
    }
    streaks.geometry.attributes.position.needsUpdate = true;
    streaks.material.opacity = Math.min(0.78, 0.10 + Math.max(0, state.ship.speed - 170) / 900);
    const starPositions = stars.geometry.attributes.position;
    const starArray = starPositions.array;
    for (let i = 2; i < starArray.length; i += 3) {
      starArray[i] += localSpeed * dt * 0.42;
      if (starArray[i] > 850) starArray[i] -= 8800;
    }
    starPositions.needsUpdate = true;
    warpRings.visible = state.route.warp > 0.025;
    warpMaterial.opacity = state.route.warp * 0.24;
    const span = 14 * 125;
    for (const ring of warpRings.children) {
      let z = -90 - ring.userData.warpIndex * 125 + (state.route.distance * 2.15) % span;
      if (z > 35) z -= span;
      ring.position.set(state.route.curveX * -12, state.route.curveY * -7, z);
      ring.rotation.z = state.route.roll + ring.userData.warpIndex * 0.07;
    }
  }

  function updateObjects(state, dt) {
    for (const body of celestials) {
      body.rotation.y += dt * (body.userData.moon ? 0.025 : 0.012);
      body.position.z = (state.route.distance - body.userData.routeAt) * body.userData.routeScale;
      for (const child of body.children || []) if (child.userData.celestialRing != null) {
        child.rotation.z += dt * (0.025 + child.userData.celestialRing * 0.006);
      }
    }
    let enemyCount = 0;
    for (const data of state.enemies) {
      if (!data.alive || enemyCount >= enemySprites.length) continue;
      const sprite = enemySprites[enemyCount++];
      const frames = enemySpriteMaterials[data.type] || enemySpriteMaterials.normal;
      sprite.visible = true; sprite.material = frames[Math.floor((data.age * 8 + (data.slot || 0)) % frames.length)];
      sprite.position.set(data.x, data.y, data.z);
      const size = data.elite ? 42 : data.type === 'armored' ? 30 : data.type === 'shooter' ? 28 : 25;
      const pulse = data.elite ? 1 + Math.sin(data.age * 5) * 0.045 : 1;
      sprite.scale.set(size * pulse, size * pulse, 1);
    }
    for (let i = enemyCount; i < enemySprites.length; i++) enemySprites[i].visible = false;
    for (let i = 0; i < state.asteroids.length; i++) {
      const a = state.asteroids[i]; tmp.position.set(a.x, a.y, a.z);
      tmp.rotation.set(a.rx + state.t * a.spin, a.ry + state.t * a.spin * 0.7, a.rz);
      tmp.scale.set(a.r, a.r * (0.72 + i % 3 * 0.12), a.r * (0.82 + i % 2 * 0.22)); tmp.updateMatrix();
      asteroidInstances.setMatrixAt(i, tmp.matrix); asteroidWireInstances.setMatrixAt(i, tmp.matrix);
    }
    asteroidInstances.count = Math.min(state.asteroids.length, asteroidInstances.instanceMatrix.count);
    asteroidWireInstances.count = asteroidInstances.count;
    asteroidInstances.instanceMatrix.needsUpdate = true;
    asteroidWireInstances.instanceMatrix.needsUpdate = true;
    // Les tirs joueur sont dessinés une seule fois dans le calque Canvas afin
    // de reprendre exactement la grammaire 2D. Le doublon WebGL créait une
    // seconde famille de projectiles légèrement décalée par la perspective.
    playerShots.geometry.setDrawRange(0, 0);
    playerShotHeads.geometry.setDrawRange(0, 0);
    // Les deux familles de projectiles sont rendues par l'unique calque Canvas
    // partagé. Garder aussi ces traits WebGL produisait deux tirs concurrents.
    enemyShots.geometry.setDrawRange(0, 0);
    enemyShotHeads.geometry.setDrawRange(0, 0);
    let powerCount = 0;
    for (const data of state.powerups || []) {
      if (powerCount >= powerupSprites.length) break;
      const sprite = powerupSprites[powerCount++]; sprite.visible = true;
      sprite.material = powerupSpriteMaterials[data.type] || powerupSpriteMaterials.double;
      sprite.position.set(data.x, data.y, data.z);
      const size = 18 + Math.sin(data.age * 7) * 1.2; sprite.scale.set(size, size, 1);
    }
    for (let i = powerCount; i < powerupSprites.length; i++) powerupSprites[i].visible = false;
    // Même règle pour les impacts : le pipeline d'explosions 2D est désormais
    // l'unique propriétaire. Les anciens anneaux/gerbes 3D restent désactivés.
    for (const object of effects.children) object.visible = false;
    effectBursts.geometry.setDrawRange(0, 0);
  }

  function updateLines(lines, data, length, heads) {
    const array = lines.geometry.attributes.position.array; let count = 0;
    const headArray = heads.geometry.attributes.position.array;
    for (let i = 0; i < data.length && count < array.length / 6; i++) {
      const shot = data[i], p = count * 6, v = new THREE.Vector3(shot.vx, shot.vy, shot.vz).normalize();
      array[p] = shot.x; array[p + 1] = shot.y; array[p + 2] = shot.z;
      array[p + 3] = shot.x - v.x * length; array[p + 4] = shot.y - v.y * length; array[p + 5] = shot.z - v.z * length;
      headArray[count * 3] = shot.x; headArray[count * 3 + 1] = shot.y; headArray[count * 3 + 2] = shot.z; count++;
    }
    lines.geometry.setDrawRange(0, count * 2); lines.geometry.attributes.position.needsUpdate = true;
    heads.geometry.setDrawRange(0, count); heads.geometry.attributes.position.needsUpdate = true;
  }

  function projectObject(object) {
    if (!object) return null;
    const worldPos = new THREE.Vector3(object.x, object.y, object.z);
    const cameraSpace = worldPos.clone().applyMatrix4(camera.matrixWorldInverse);
    const ahead = cameraSpace.z < 0;
    const projected = worldPos.project(camera);
    let x = (projected.x * 0.5 + 0.5) * width;
    let y = (-projected.y * 0.5 + 0.5) * height;
    if (!ahead) { x = width - x; y = height - y; }
    return { x, y, scale: Math.max(0.34, Math.min(1.25, 250 / Math.max(1, -cameraSpace.z))),
      visible: ahead && projected.z > -1 && projected.z < 1 && x >= 0 && x <= width && y >= 0 && y <= height };
  }

  function projectProjectile(shot, length) {
    const head = projectObject(shot);
    if (!head) return null;
    const d = Math.hypot(shot.vx, shot.vy, shot.vz) || 1;
    // La traînée ne peut jamais remonter derrière son point de naissance.
    // Sans ce clamp, ses premières images passaient derrière la caméra : le
    // trait traversait alors l'écran en diagonale et semblait détaché du nez.
    const travelled = Math.hypot(shot.x - (shot.ox ?? shot.x), shot.y - (shot.oy ?? shot.y), shot.z - (shot.oz ?? shot.z));
    const trail = Math.min(length, travelled);
    const tail = projectObject({ x: shot.x - shot.vx / d * trail, y: shot.y - shot.vy / d * trail, z: shot.z - shot.vz / d * trail });
    return { ...head, tx: tail?.x ?? head.x, ty: tail?.y ?? head.y };
  }

  function projectIncomingShot(shot, state) {
    const marker = projectProjectile(shot, 58);
    if (!marker || !(shot.vz > 0)) return marker;
    const eta = (-18 - shot.z) / shot.vz;
    if (eta < 0 || eta > 2.2) return marker;
    const impactWorld = { x: shot.x + shot.vx * eta, y: shot.y + shot.vy * eta, z: -18 };
    const impact = projectObject(impactWorld);
    if (impact) {
      marker.ix = impact.x; marker.iy = impact.y; marker.impactVisible = impact.visible;
      marker.eta = eta;
      marker.threat = Math.abs(impactWorld.x - state.ship.x) < 8 && Math.abs(impactWorld.y - state.ship.y) < 7;
    }
    return marker;
  }

  function projectPowerup(powerup) {
    const marker = projectObject(powerup);
    const eta = Math.max(0, (-16 - powerup.z) / 150);
    const landing = projectObject({ x: powerup.x, y: powerup.y, z: -16 });
    return { ...marker, id: powerup.id, type: powerup.type, eta,
      lx: landing?.x, ly: landing?.y, landingVisible: !!landing?.visible };
  }

  function projectTarget(state) {
    const marker = projectObject(state.target);
    if (marker) marker.elite = !!state.target.elite;
    return marker;
  }

  function projectAim(state) {
    // Le curseur représente l'intersection du tir avec le premier plan de
    // combat, pas un point arbitraire au fond du tunnel. Ainsi un ennemi placé
    // sous le curseur partage réellement les X/Y du projectile à cette profondeur.
    let depth = -220;
    for (const enemy of state.enemies || []) {
      if (enemy.alive && enemy.z < -35 && enemy.z > depth) depth = enemy.z;
    }
    depth = Math.max(-420, Math.min(-150, depth));
    const marker = projectObject({ x: state.ship.x, y: state.ship.y + 0.8, z: depth });
    if (marker) marker.depth = depth;
    return marker;
  }

  function frame(state, viewportWidth, viewportHeight) {
    if (!init()) return null;
    resize(viewportWidth || 1200, viewportHeight || 800);
    const theme = Math.max(0, state.theme | 0) % SPACE_LOOKS.length;
    const selectedShip = SHIP_FORMS[state.shipId] ? state.shipId : 'classic';
    if (!world || theme !== themeIndex || selectedShip !== shipId) build(theme, selectedShip);
    const frameId = window.FRAME?.frame ?? 0;
    if (frameId !== lastFrame) {
      lastFrame = frameId; const dt = Math.min(0.05, window.FRAME?.rawDt || 0);
      updateShip(state, dt); updateStreaks(state, dt); updateObjects(state, dt);
      renderer.toneMappingExposure = 1.10 + state.route.warp * 0.34;
      renderer.render(scene, camera);
    }
    const effectMarkers = (state.effects || []).map((item) => ({ ...projectObject(item), id: item.id,
      points: item.points || 0, alpha: item.life / item.max }));
    const playerProjectileMarkers = (state.shots || []).map((item) => projectProjectile(item, 105));
    const enemyProjectileMarkers = (state.enemyShots || []).map((item) => projectIncomingShot(item, state));
    const powerupMarkers = (state.powerups || []).map(projectPowerup);
    const hazardMarkers = (state.asteroids || []).filter((item) => item.hazard && item.z > -520 && item.z < 35 &&
      Math.abs(item.x - state.ship.x) < 32 && Math.abs(item.y - state.ship.y) < 24).map(projectObject);
    return { canvas: renderer.domElement, markers: { ship: projectObject({ x: state.ship.x, y: state.ship.y, z: 0 }),
      target: projectTarget(state), aim: projectAim(state), effects: effectMarkers,
      playerShots: playerProjectileMarkers, enemyShots: enemyProjectileMarkers, powerups: powerupMarkers, hazards: hazardMarkers },
      stats: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } };
  }

  return { frame, isAvailable: () => init() };
})();

window.TRANSIT3D = TRANSIT3D;
