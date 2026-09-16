import * as THREE from 'three';

/** Palette matérielle commune aux décors 3D, également utilisée en transit. */
export const SPACE_LOOKS = [
  { kind: 'ringed', base: '#123850', light: '#8fd7ea', accent: '#d9b66f', atmosphere: '#65bdd7', bands: 10, roughness: 0.76 },
  { kind: 'gas', base: '#4b2615', light: '#d69a58', accent: '#7c3520', atmosphere: '#e4a65d', bands: 18, roughness: 0.88 },
  { kind: 'binary', base: '#381f46', light: '#b87ac8', accent: '#ef9b78', atmosphere: '#c48ad5', bands: 7, roughness: 0.62 },
  { kind: 'volcanic', base: '#190d0b', light: '#70402d', accent: '#ff692e', atmosphere: '#d9552e', bands: 5, roughness: 0.96 },
  { kind: 'crystal', base: '#073c34', light: '#47a990', accent: '#b4ffe2', atmosphere: '#56d7b4', bands: 4, roughness: 0.34 },
  { kind: 'blackhole', base: '#050309', light: '#35175b', accent: '#ffc978', atmosphere: '#8d60ca', bands: 8, roughness: 0.70 },
  { kind: 'ice', base: '#183951', light: '#a8d4e5', accent: '#e7f7ff', atmosphere: '#8bcbe5', bands: 8, roughness: 0.48 },
  { kind: 'sun', base: '#6c2606', light: '#ffc25a', accent: '#fff1b1', atmosphere: '#ff9e3d', bands: 16, roughness: 0.64 },
  { kind: 'ocean', base: '#062d3c', light: '#1889a8', accent: '#70dfc0', atmosphere: '#43cbd0', bands: 11, roughness: 0.58 },
  { kind: 'shattered', base: '#24182f', light: '#795882', accent: '#ff8a68', atmosphere: '#bb70a8', bands: 6, roughness: 0.82 }
];

/**
 * Couche céleste 2,5D de Galabob.
 *
 * Three.js ne possède aucune logique de jeu : il remplace uniquement le corps
 * céleste pré-rendu de backdrop.js. Le résultat WebGL transparent est composé
 * dans le Canvas 2D, ce qui conserve les collisions, le HUD, le screenshake et
 * le repli historique lorsque WebGL 2 n'est pas disponible.
 */
const SPACE3D = (() => {
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const MAX_PIXELS = 900_000;
  const CAMERA_Z = 8;
  const FOV = 38;

  const LOOKS = SPACE_LOOKS;

  let renderer = null;
  let scene = null;
  let camera = null;
  let world = null;
  let keyLight = null;
  let rimLight = null;
  let currentTheme = -1;
  let fade = 0;
  let lastFrame = -1;
  let width = 0;
  let height = 0;
  let pixelScale = 0.7;
  let available = false;
  let failed = false;
  let rotationClock = 0;
  const resources = [];
  const dangerColor = new THREE.Color('#ff354d');

  function track(value) {
    resources.push(value);
    return value;
  }

  function init() {
    if (renderer || failed) return available;
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2')) throw new Error('WebGL 2 indisponible');
      renderer = new THREE.WebGLRenderer({
        canvas: probe,
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = false;
      probe.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        available = false;
        failed = true;
      });

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 30);
      camera.position.z = CAMERA_Z;

      scene.add(new THREE.HemisphereLight(0x8ab6c8, 0x08050d, 0.34));
      keyLight = new THREE.DirectionalLight(0xffeed5, 3.1);
      keyLight.position.set(-4, -2, 6);
      scene.add(keyLight);
      rimLight = new THREE.PointLight(0x5ccfff, 7.5, 18, 2);
      rimLight.position.set(3.5, 2.2, 3.5);
      scene.add(rimLight);

      available = true;
    } catch (error) {
      failed = true;
      available = false;
      console.info('SPACE3D : repli Canvas 2D —', error?.message || error);
    }
    return available;
  }

  function disposeWorld() {
    if (world && scene) scene.remove(world);
    for (const item of resources.splice(0)) {
      try { item.dispose?.(); } catch (_) { /* ressource déjà libérée */ }
    }
    world = null;
  }

  function seeded(seed) {
    let state = (seed | 0) || 1;
    return () => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
  }

  function mixHex(a, b, amount) {
    const A = new THREE.Color(a);
    return '#' + A.lerp(new THREE.Color(b), amount).getHexString();
  }

  function planetTexture(look, seed) {
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 256;
    const c = cv.getContext('2d');
    const random = seeded(seed * 9173 + 41);

    const base = c.createLinearGradient(0, 0, 0, cv.height);
    base.addColorStop(0, mixHex(look.base, look.light, 0.16));
    base.addColorStop(0.48, look.base);
    base.addColorStop(1, mixHex(look.base, '#02030a', 0.48));
    c.fillStyle = base;
    c.fillRect(0, 0, cv.width, cv.height);

    // Bandes irrégulières continues : assez de matière pour accrocher la
    // rotation, sans texture téléchargée ni couture visible sur la sphère.
    const rows = look.bands * 3;
    for (let i = 0; i < rows; i++) {
      const y = (i + random()) / rows * cv.height;
      const thick = 2 + random() * (cv.height / rows) * 1.6;
      c.globalAlpha = 0.05 + random() * 0.17;
      c.fillStyle = random() > 0.72 ? look.accent : look.light;
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x <= cv.width; x += 16) {
        c.lineTo(x, y + Math.sin(x * 0.025 + i * 1.7) * thick * 0.55 + (random() - 0.5) * thick);
      }
      c.lineTo(cv.width, y + thick);
      c.lineTo(0, y + thick);
      c.closePath();
      c.fill();
    }

    if (look.kind === 'volcanic' || look.kind === 'shattered') {
      c.globalCompositeOperation = 'screen';
      for (let i = 0; i < 42; i++) {
        const x = random() * cv.width;
        const y = random() * cv.height;
        c.strokeStyle = look.accent;
        c.globalAlpha = 0.12 + random() * 0.34;
        c.lineWidth = 0.7 + random() * 1.6;
        c.beginPath();
        c.moveTo(x, y);
        for (let j = 1; j < 5; j++) {
          c.lineTo(x + (random() - 0.45) * j * 15, y + j * (4 + random() * 8));
        }
        c.stroke();
      }
    } else if (look.kind !== 'gas' && look.kind !== 'sun') {
      for (let i = 0; i < 70; i++) {
        const r = 1 + random() * random() * 11;
        c.globalAlpha = 0.04 + random() * 0.10;
        c.fillStyle = random() > 0.5 ? look.light : '#02030a';
        c.beginPath();
        c.ellipse(random() * cv.width, random() * cv.height, r * 1.8, r, random(), 0, Math.PI * 2);
        c.fill();
      }
    }

    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    const texture = track(new THREE.CanvasTexture(cv));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  function reliefTexture(look, seed) {
    const w = 256, h = 128;
    const data = new Uint8Array(w * h);
    const random = seeded(seed * 1259 + 73);
    const p1 = random() * Math.PI * 2;
    const p2 = random() * Math.PI * 2;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = x / w * Math.PI * 2;
        const ny = y / h * Math.PI;
        const bands = Math.sin(ny * look.bands + Math.sin(nx * 2.0 + p1) * 0.72) * 34;
        const broad = Math.sin(nx * 3.0 + ny * 5.0 + p2) * 20;
        const grain = (random() - 0.5) * (look.kind === 'gas' || look.kind === 'sun' ? 20 : 54);
        data[y * w + x] = Math.max(0, Math.min(255, 128 + bands + broad + grain));
      }
    }
    const texture = track(new THREE.DataTexture(data, w, h, THREE.RedFormat));
    texture.wrapS = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  function atmosphere(color, radius = 1.05, strength = 0.34) {
    const geometry = track(new THREE.SphereGeometry(radius, 36, 24));
    const material = track(new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      uniforms: {
        glowColor: { value: new THREE.Color(color) },
        strength: { value: strength }
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          vNormal = normalize(mat3(modelMatrix) * normal);
          vView = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        uniform vec3 glowColor;
        uniform float strength;
        void main() {
          float fresnel = pow(1.0 - max(0.0, dot(vNormal, vView)), 2.4);
          gl_FragColor = vec4(glowColor, fresnel * strength);
        }
      `
    }));
    return new THREE.Mesh(geometry, material);
  }

  function sphere(look, seed, radius = 1) {
    const detail = look.kind === 'crystal' ? 3 : null;
    const geometry = track(detail
      ? new THREE.IcosahedronGeometry(radius, detail)
      : new THREE.SphereGeometry(radius, 44, 28));
    const material = track(new THREE.MeshStandardMaterial({
      map: planetTexture(look, seed),
      bumpMap: reliefTexture(look, seed),
      bumpScale: look.kind === 'gas' || look.kind === 'sun' ? 0.018 : 0.045,
      color: 0xffffff,
      roughness: look.roughness,
      metalness: look.kind === 'crystal' ? 0.28 : 0.04,
      flatShading: look.kind === 'crystal',
      emissive: new THREE.Color(look.kind === 'sun' || look.kind === 'volcanic' ? look.accent : '#000000'),
      emissiveIntensity: look.kind === 'sun' ? 0.32 : (look.kind === 'volcanic' ? 0.11 : 0)
    }));
    return new THREE.Mesh(geometry, material);
  }

  function addRings(group, look, wide = false) {
    const mat = track(new THREE.MeshBasicMaterial({
      color: new THREE.Color(look.accent),
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false
    }));
    const ring = new THREE.Mesh(track(new THREE.RingGeometry(1.28, wide ? 2.15 : 1.82, 96)), mat);
    ring.rotation.x = Math.PI * 0.43;
    ring.rotation.z = -0.18;
    group.add(ring);

    const edgeMat = track(mat.clone());
    edgeMat.opacity = 0.24;
    for (const radius of [1.36, wide ? 2.05 : 1.72]) {
      const edge = new THREE.Mesh(track(new THREE.TorusGeometry(radius, 0.012, 5, 96)), edgeMat);
      edge.rotation.copy(ring.rotation);
      group.add(edge);
    }
  }

  function addMoon(group, look, radius, orbit, phase) {
    const moonLook = { ...look, base: mixHex(look.base, '#6b7488', 0.55), light: '#aeb8c8', accent: look.light, bands: 3, roughness: 1 };
    const moon = sphere(moonLook, currentTheme + 31, radius);
    moon.userData.orbit = orbit;
    moon.userData.phase = phase;
    moon.userData.moon = true;
    group.add(moon);
  }

  function buildWorld(themeIndex) {
    disposeWorld();
    currentTheme = themeIndex;
    const look = LOOKS[themeIndex % LOOKS.length];
    world = new THREE.Group();
    world.rotation.z = 0.08;

    if (look.kind === 'blackhole') {
      const voidMat = track(new THREE.MeshBasicMaterial({ color: 0x010104 }));
      world.add(new THREE.Mesh(track(new THREE.SphereGeometry(0.72, 40, 28)), voidMat));
      const diskMat = track(new THREE.MeshBasicMaterial({
        color: new THREE.Color(look.accent), transparent: true, opacity: 0.68,
        side: THREE.DoubleSide, depthWrite: false
      }));
      for (let i = 0; i < 5; i++) {
        const disk = new THREE.Mesh(track(new THREE.TorusGeometry(1.0 + i * 0.16, 0.055 + i * 0.012, 8, 96)), diskMat.clone());
        track(disk.material);
        disk.rotation.x = Math.PI * (0.42 + i * 0.008);
        disk.rotation.z = -0.22;
        disk.userData.disk = i;
        world.add(disk);
      }
      world.add(atmosphere(look.atmosphere, 1.12, 0.42));
    } else if (look.kind === 'binary') {
      const a = sphere(look, themeIndex * 2 + 1, 0.67);
      const bLook = { ...look, base: look.accent, light: '#ffd0a8', accent: look.light };
      const b = sphere(bLook, themeIndex * 2 + 2, 0.48);
      a.position.set(-0.58, 0.16, 0);
      b.position.set(0.70, -0.18, 0.18);
      a.userData.star = 1;
      b.userData.star = -1;
      world.add(a, b);
      const bridge = new THREE.Mesh(
        track(new THREE.CylinderGeometry(0.018, 0.018, 1.38, 8)),
        track(new THREE.MeshBasicMaterial({ color: look.atmosphere, transparent: true, opacity: 0.22 }))
      );
      bridge.rotation.z = Math.PI / 2 - 0.25;
      world.add(bridge);
      world.add(atmosphere(look.atmosphere, 1.42, 0.22));
    } else {
      world.add(sphere(look, themeIndex + 1));
      world.add(atmosphere(look.atmosphere, 1.07, look.kind === 'sun' ? 0.48 : 0.30));
      if (look.kind === 'ringed' || look.kind === 'gas' || look.kind === 'ocean') addRings(world, look, look.kind === 'ringed');
      if (look.kind === 'ice' || look.kind === 'ocean') addMoon(world, look, 0.13, 1.62, 1.4);
      if (look.kind === 'shattered') {
        for (let i = 0; i < 9; i++) {
          const shard = new THREE.Mesh(
            track(new THREE.TetrahedronGeometry(0.08 + (i % 3) * 0.035)),
            track(new THREE.MeshStandardMaterial({ color: i % 2 ? look.light : look.accent, roughness: 0.72 }))
          );
          const a = i / 9 * Math.PI * 2;
          shard.position.set(Math.cos(a) * (1.28 + (i % 2) * 0.18), Math.sin(a) * 0.72, (i % 3 - 1) * 0.18);
          shard.userData.shard = i;
          world.add(shard);
        }
      }
    }

    scene.add(world);
    keyLight.color.set(look.kind === 'ice' || look.kind === 'ocean' ? 0xd8f8ff : 0xffe2bd);
    rimLight.color.set(look.atmosphere);
    fade = 0;
  }

  function resize(w, h) {
    if (w === width && h === height) return;
    width = Math.max(1, w | 0);
    height = Math.max(1, h | 0);
    pixelScale = Math.min(0.76, Math.max(0.48, Math.sqrt(MAX_PIXELS / (width * height))));
    const rw = Math.max(1, Math.round(width * pixelScale));
    const rh = Math.max(1, Math.round(height * pixelScale));
    renderer.setSize(rw, rh, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function updateObjects(time, dt, intensity) {
    if (!world) return;
    rotationClock += dt * (REDUCED_MOTION ? 0.18 : 1);
    world.rotation.y = rotationClock * (0.055 + intensity * 0.025);
    world.rotation.x = -0.12 + Math.sin(time * 0.09) * 0.025;
    for (const child of world.children) {
      if (child.userData.moon) {
        const a = rotationClock * 0.34 + child.userData.phase;
        child.position.set(Math.cos(a) * child.userData.orbit, Math.sin(a) * child.userData.orbit * 0.32, Math.sin(a) * 0.42);
      } else if (child.userData.disk != null) {
        child.rotation.z = -0.22 + rotationClock * (0.06 + child.userData.disk * 0.012);
      } else if (child.userData.shard != null) {
        child.rotation.x = rotationClock * (0.20 + child.userData.shard * 0.018);
        child.rotation.y = rotationClock * 0.16;
      } else if (child.userData.star) {
        child.rotation.y = rotationClock * 0.12 * child.userData.star;
      }
    }
  }

  /** Prépare une frame transparente à composer par backdrop.js. */
  function frame(options) {
    if (!init()) return null;
    const w = options.width | 0;
    const h = options.height | 0;
    resize(w, h);
    const themeIndex = ((options.themeIndex | 0) % LOOKS.length + LOOKS.length) % LOOKS.length;
    if (themeIndex !== currentTheme || !world) buildWorld(themeIndex);

    const frameId = window.FRAME?.frame ?? 0;
    if (lastFrame !== frameId) {
      lastFrame = frameId;
      const dt = Math.min(0.05, Math.max(0, window.FRAME?.rawDt ?? 1 / 60));
      const time = window.FRAME?.realTime ?? 0;
      fade = Math.min(1, fade + dt / 0.7);

      const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV * 0.5)) * CAMERA_Z;
      const viewW = viewH * camera.aspect;
      const px = (options.x / w - 0.5) * viewW;
      const py = -(options.y / h - 0.5) * viewH;
      const radius = Math.max(0.12, options.radius / h * viewH);
      world.position.set(px, py, 0);
      world.scale.setScalar(radius);

      const playerX = window.player ? (window.player.x + window.player.width / 2) / w - 0.5 : 0;
      camera.position.x += ((playerX * 0.18) - camera.position.x) * Math.min(1, dt * 2.2);
      camera.lookAt(camera.position.x * 0.18, 0, 0);
      rimLight.color.set(LOOKS[currentTheme].atmosphere).lerp(dangerColor, Math.min(0.42, (options.danger || 0) * 0.42));
      updateObjects(time, dt, options.intensity || 0);
      renderer.render(scene, camera);
    }

    return { canvas: renderer.domElement, alpha: fade, scale: pixelScale };
  }

  function stats() {
    return {
      available,
      failed,
      theme: currentTheme,
      scale: pixelScale,
      calls: renderer?.info.render.calls ?? 0,
      triangles: renderer?.info.render.triangles ?? 0
    };
  }

  return { frame, isAvailable: () => init(), stats };
})();

window.SPACE3D = SPACE3D;
