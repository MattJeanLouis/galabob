import * as THREE from 'three';

/**
 * Coques 3D des boss. La simulation et les collisions restent intégralement
 * dans boss.js : ce module ne reçoit qu'un instantané visuel et produit un
 * canvas transparent à composer dans la scène 2D.
 */
const BOSS3D = (() => {
  const FOV = 38;
  const CAMERA_Z = 8;
  const MAX_PIXELS = 720_000;
  const REDUCED_MOTION = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const IDENTITIES = [
    ['#3b101d', '#bd2946'], ['#35132c', '#cf386f'], ['#3a1618', '#e34d3f'],
    ['#49120f', '#ff593b'], ['#271522', '#bd315c'], ['#160d19', '#e94b66']
  ];

  let renderer = null;
  let scene = null;
  let camera = null;
  let root = null;
  let overlayRoot = null;
  let current = -1;
  let width = 0;
  let height = 0;
  let scale = 0.7;
  let fade = 0;
  let lastFrame = -1;
  let available = false;
  let failed = false;
  let armorMaterial = null;
  let accentMaterial = null;
  let weakMaterial = null;
  const weakMeshes = [];
  const segmentMeshes = [];
  const dynamicMeshes = [];
  const resources = [];

  function track(resource) {
    resources.push(resource);
    return resource;
  }

  function init() {
    if (renderer || failed) return available;
    try {
      const canvas = document.createElement('canvas');
      if (!canvas.getContext('webgl2')) throw new Error('WebGL 2 indisponible');
      renderer = new THREE.WebGLRenderer({
        canvas, alpha: true, antialias: false, premultipliedAlpha: true,
        powerPreference: 'high-performance'
      });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;
      renderer.shadowMap.enabled = false;
      canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        available = false;
        failed = true;
      });

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 30);
      camera.position.z = CAMERA_Z;
      scene.add(new THREE.HemisphereLight(0xb9c6df, 0x12050b, 0.52));
      const key = new THREE.DirectionalLight(0xffd2b5, 4.2);
      key.position.set(-4, -3, 6);
      scene.add(key);
      const rim = new THREE.PointLight(0xff3355, 11, 18, 2);
      rim.position.set(3.4, 2.2, 3.8);
      scene.add(rim);
      available = true;
    } catch (error) {
      failed = true;
      console.info('BOSS3D : repli vectoriel —', error?.message || error);
    }
    return available;
  }

  function disposeModel() {
    if (root) scene.remove(root);
    if (overlayRoot) scene.remove(overlayRoot);
    for (const resource of resources.splice(0)) {
      try { resource.dispose?.(); } catch (_) { /* déjà libérée */ }
    }
    root = null;
    overlayRoot = null;
    weakMeshes.length = 0;
    segmentMeshes.length = 0;
    dynamicMeshes.length = 0;
  }

  function armorTexture(dark, accent, seed) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const c = canvas.getContext('2d');
    const gradient = c.createRadialGradient(86, 62, 8, 128, 128, 190);
    gradient.addColorStop(0, accent);
    gradient.addColorStop(0.24, dark);
    gradient.addColorStop(1, '#09070d');
    c.fillStyle = gradient;
    c.fillRect(0, 0, 256, 256);
    c.globalAlpha = 0.18;
    c.strokeStyle = accent;
    c.lineWidth = 2;
    const offset = 17 + seed * 11;
    for (let y = -64; y < 320; y += 48) {
      c.beginPath();
      c.moveTo(0, y + offset);
      c.lineTo(256, y - 38 + offset);
      c.stroke();
    }
    c.globalAlpha = 0.10;
    c.fillStyle = '#ffd8cf';
    for (let i = 0; i < 90; i++) {
      const x = (i * 73 + seed * 19) % 256;
      const y = (i * 131 + seed * 41) % 256;
      c.fillRect(x, y, i % 5 === 0 ? 7 : 2, 1);
    }
    const texture = track(new THREE.CanvasTexture(canvas));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
  }

  function mat(color, metalness, roughness, emissive = '#000000', intensity = 0, map = null) {
    return track(new THREE.MeshPhysicalMaterial({
      color, map, metalness, roughness, emissive, emissiveIntensity: intensity,
      clearcoat: metalness > 0.5 ? 0.42 : 0.18,
      clearcoatRoughness: 0.34
    }));
  }

  function mesh(geometry, material, parent = root) {
    const value = new THREE.Mesh(track(geometry), material);
    parent.add(value);
    return value;
  }

  function torus(radius, tube, material, parent = root) {
    return mesh(new THREE.TorusGeometry(radius, tube, 8, 48), material, parent);
  }

  function extruded(points, depth, bevel, material, parent = root) {
    const shape = new THREE.Shape();
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth, steps: 1, bevelEnabled: true, bevelSegments: 3,
      bevelSize: bevel, bevelThickness: bevel
    });
    geometry.center();
    return mesh(geometry, material, parent);
  }

  function armorPlate(points, z, material = accentMaterial) {
    const plate = extruded(points, 0.08, 0.025, material);
    plate.position.z = z;
    return plate;
  }

  function build(index) {
    disposeModel();
    current = index;
    root = new THREE.Group();
    overlayRoot = new THREE.Group();
    scene.add(root, overlayRoot);
    const colors = IDENTITIES[index] || IDENTITIES[0];
    const surface = armorTexture(colors[0], colors[1], index + 1);
    surface.repeat.set(1.4, 1.4);
    armorMaterial = mat('#b9a5ad', 0.78, 0.36, '#26040b', 0.08, surface);
    accentMaterial = mat(colors[1], 0.52, 0.28, colors[1], 0.20);
    weakMaterial = mat('#ffd166', 0.18, 0.24, '#ff9f2d', 0.62);

    if (index === 0) {
      // Porte-essaim : une seule silhouette large, carénée, immédiatement
      // lisible ; les plaques imbriquées rappellent un abdomen d'insecte.
      extruded([[-1.72, 0], [-1.14, -0.62], [-0.38, -0.82], [0.38, -0.82],
        [1.14, -0.62], [1.72, 0], [1.10, 0.64], [0, 0.84], [-1.10, 0.64]],
        0.54, 0.12, armorMaterial);
      for (let i = -2; i <= 2; i++) {
        armorPlate([[i * 0.48 - 0.21, -0.45], [i * 0.48 + 0.21, -0.45],
          [i * 0.48 + 0.27, 0.35], [i * 0.48, 0.53], [i * 0.48 - 0.27, 0.35]], 0.34);
      }
      for (const side of [-1, 1]) {
        const jaw = extruded([[0, -0.13], [side * 0.80, 0], [side * 0.34, 0.20]], 0.22, 0.05, accentMaterial);
        jaw.position.set(side * 1.35, 0.38, 0.05);
        jaw.userData.jaw = side;
      }
    } else if (index === 1) {
      // Cristal taillé : facettes franches, noyau suspendu et vrais miroirs
      // positionnés ensuite d'après les fragments du gameplay.
      const prism = mesh(new THREE.OctahedronGeometry(1.02, 0), armorMaterial);
      prism.scale.set(0.82, 1.16, 0.68);
      prism.userData.spin = -0.42;
      const inner = mesh(new THREE.OctahedronGeometry(0.54, 0), accentMaterial);
      inner.position.z = 0.35;
      inner.userData.counter = 1;
      torus(1.08, 0.028, accentMaterial).rotation.x = 1.08;
      for (let i = 0; i < 8; i++) {
        const shard = mesh(new THREE.TetrahedronGeometry(0.34), armorMaterial, overlayRoot);
        shard.visible = false;
        dynamicMeshes.push(shard);
      }
    } else if (index === 2) {
      // Tête en pointe et colonne réellement calée sur les maillons simulés.
      const head = extruded([[-0.92, -0.38], [-0.48, -0.78], [0, -1.02],
        [0.48, -0.78], [0.92, -0.38], [0.64, 0.64], [0, 0.92], [-0.64, 0.64]],
        0.62, 0.10, armorMaterial);
      armorPlate([[-0.46, -0.36], [0, -0.72], [0.46, -0.36], [0.27, 0.38], [0, 0.56], [-0.27, 0.38]], 0.39);
      for (const side of [-1, 1]) {
        const jaw = extruded([[0, 0], [side * 0.48, 0.16], [side * 0.32, 0.86]], 0.20, 0.04, accentMaterial);
        jaw.position.set(side * 0.18, 0.46, 0.08);
        jaw.userData.jaw = side;
      }
      for (let i = 0; i < 16; i++) {
        const seg = mesh(new THREE.CapsuleGeometry(0.34, 0.38, 3, 8), armorMaterial, overlayRoot);
        seg.visible = false;
        segmentMeshes.push(seg);
      }
    } else if (index === 3) {
      // Organe-machine : deux ventricules blindés autour d'un noyau exposé.
      const left = mesh(new THREE.SphereGeometry(0.66, 24, 16), armorMaterial);
      left.position.set(-0.39, -0.18, 0); left.scale.set(0.92, 1.12, 0.70);
      const right = mesh(new THREE.SphereGeometry(0.66, 24, 16), armorMaterial);
      right.position.set(0.39, -0.18, 0); right.scale.set(0.92, 1.12, 0.70);
      const heart = extruded([[-0.76, -0.08], [0, 1.12], [0.76, -0.08], [0.42, 0.52], [0, 0.82], [-0.42, 0.52]], 0.46, 0.10, armorMaterial);
      heart.userData.heart = true;
      left.userData.heart = true; right.userData.heart = true;
      const core = mesh(new THREE.IcosahedronGeometry(0.42, 2), accentMaterial);
      core.position.set(0, 0.06, 0.48);
      core.userData.heart = true;
      for (let i = 0; i < 3; i++) {
        const ring = torus(1.05 + i * 0.17, 0.018, accentMaterial);
        ring.rotation.set(0.72 + i * 0.21, 0.22, i * 0.7);
        ring.userData.counter = i % 2 ? -1 : 1;
      }
    } else if (index === 4) {
      // Forteresse : masse octogonale, plaques en croix et tourelles placées
      // sur les véritables points d'ancrage orbitaux.
      extruded([[-0.92, -0.42], [-0.42, -0.92], [0.42, -0.92], [0.92, -0.42],
        [0.92, 0.42], [0.42, 0.92], [-0.42, 0.92], [-0.92, 0.42]], 0.72, 0.12, armorMaterial);
      armorPlate([[-0.24, -0.86], [0.24, -0.86], [0.34, 0.86], [-0.34, 0.86]], 0.46);
      armorPlate([[-0.86, -0.24], [0.86, -0.34], [0.86, 0.24], [-0.86, 0.34]], 0.48);
      const core = mesh(new THREE.CylinderGeometry(0.34, 0.48, 0.46, 8), accentMaterial);
      core.rotation.x = Math.PI / 2; core.position.z = 0.52;
      for (let i = 0; i < 4; i++) {
        const tower = mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.66, 6), armorMaterial, overlayRoot);
        tower.visible = false;
        dynamicMeshes.push(tower);
      }
    } else {
      // Le centre absorbe la lumière ; les deux astres réels sont reconstruits
      // à leurs coordonnées de collision, pas posés arbitrairement.
      mesh(new THREE.SphereGeometry(0.70, 32, 22), mat('#030106', 0.05, 0.96));
      for (let i = 0; i < 5; i++) {
        const disk = torus(0.86 + i * 0.105, 0.024 + i * 0.006, accentMaterial);
        disk.rotation.x = 1.08 + i * 0.018;
        disk.userData.counter = i % 2 ? -1 : 1;
      }
      for (let i = 0; i < 2; i++) {
        const star = new THREE.Group();
        const globe = mesh(new THREE.IcosahedronGeometry(0.54, 2), accentMaterial, star);
        globe.userData.spin = i ? -0.7 : 0.7;
        const corona = torus(0.70, 0.035, weakMaterial, star);
        corona.userData.counter = i ? -1 : 1;
        star.visible = false;
        overlayRoot.add(star);
        dynamicMeshes.push(star);
      }
    }

    for (let i = 0; i < 24; i++) {
      const weak = new THREE.Group();
      const ring = torus(0.52, 0.055, weakMaterial, weak);
      const lens = mesh(new THREE.SphereGeometry(0.25, 12, 8), weakMaterial, weak);
      lens.scale.z = 0.48;
      ring.userData.counter = i % 2 ? -1 : 1;
      weak.visible = false;
      overlayRoot.add(weak);
      weakMeshes.push(weak);
    }
    fade = 0;
  }

  function resize(w, h) {
    if (w === width && h === height) return;
    width = Math.max(1, w | 0);
    height = Math.max(1, h | 0);
    scale = Math.min(0.78, Math.max(0.48, Math.sqrt(MAX_PIXELS / (width * height))));
    renderer.setSize(Math.round(width * scale), Math.round(height * scale), false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function updateParts(options, radius, time) {
    let wi = 0, si = 0, di = 0;
    const parts = options.parts || [];
    for (const part of parts) {
      if (!part || part.vivant === false) continue;
      const ox = (part.x - options.x) / radius;
      const oy = -(part.y - options.y) / radius;
      if (options.index === 2 && part.kind === 'segment' && segmentMeshes[si]) {
        const seg = segmentMeshes[si++];
        seg.visible = true;
        seg.position.set(ox, oy, -0.10 - si * 0.008);
        seg.scale.setScalar(Math.max(0.30, part.r / radius * 1.45));
        seg.rotation.set(time * 0.22 + si * 0.4, 0, -(part.angle || 0) - Math.PI / 2);
      }

      const dynamic = (options.index === 1 && part.kind === 'fragment') ||
        (options.index === 4 && part.kind === 'faible') ||
        (options.index === 5 && part.kind === 'faible');
      if (dynamic && dynamicMeshes[di]) {
        const object = dynamicMeshes[di++];
        object.visible = true;
        object.position.set(ox, oy, 0.10 + di * 0.025);
        const ratio = Math.max(0.28, part.r / radius);
        object.scale.setScalar(options.index === 4 ? ratio * 1.35 : ratio * 1.18);
        object.rotation.set(time * (0.30 + di * 0.04), time * 0.42, -(part.angle || 0));
      }
      const target = part.kind === 'faible' || part.kind === 'fragment' ||
        ((part.kind === 'segment' || part.kind === 'tete') && part.vulnerable);
      if (!target || !weakMeshes[wi]) continue;
      const weak = weakMeshes[wi++];
      weak.visible = true;
      weak.position.set(ox, oy, 0.36);
      const pulse = 1 + Math.sin(time * 4.4 + wi) * 0.055;
      weak.scale.setScalar(Math.max(0.30, part.r / radius * 0.82) * pulse);
      weak.rotation.set(0, 0, time * (wi % 2 ? -0.55 : 0.55));
    }
    for (; wi < weakMeshes.length; wi++) weakMeshes[wi].visible = false;
    for (; si < segmentMeshes.length; si++) segmentMeshes[si].visible = false;
    for (; di < dynamicMeshes.length; di++) dynamicMeshes[di].visible = false;
  }

  function animate(options, dt, time) {
    const speed = REDUCED_MOTION ? 0.25 : 1;
    const phase = options.phase || 1;
    const death = Math.max(0, Math.min(1, options.death || 0));
    const wounded = 1 - Math.max(0, Math.min(1, options.hp == null ? 1 : options.hp));
    root.rotation.z = -(options.angle || 0);
    root.rotation.x = -0.18 + Math.sin(time * 0.7) * 0.035 + death * 0.72;
    root.rotation.y = Math.sin(time * 0.38) * 0.18 + death * 1.8;
    for (let childIndex = 0; childIndex < root.children.length; childIndex++) {
      const child = root.children[childIndex];
      if (child.userData.spin) child.rotation.y += dt * child.userData.spin * speed * (1 + phase * 0.18);
      if (child.userData.orbit != null) {
        const a = time * (0.45 + phase * 0.12) * speed + child.userData.orbit * Math.PI * 0.4;
        child.position.set(Math.cos(a) * 1.42, Math.sin(a) * 0.82, Math.sin(a) * 0.35);
        child.rotation.set(a, a * 1.7, 0);
      }
      if (child.userData.counter) child.rotation.z += dt * child.userData.counter * (0.28 + phase * 0.12) * speed;
      if (child.userData.heart) {
        const beat = 1 + Math.pow(Math.max(0, options.pulse || 0), 2) * 0.14;
        child.scale.multiplyScalar(beat / (child.userData.lastBeat || 1));
        child.userData.lastBeat = beat;
      }
      if (child.userData.jaw) {
        child.rotation.z = child.userData.jaw * (0.04 + (options.open || 0) * 0.18);
      }
      if (death > 0) {
        const a = childIndex * 2.399 + current;
        child.position.x += Math.cos(a) * dt * death * 0.34;
        child.position.y += Math.sin(a) * dt * death * 0.28;
        child.position.z += dt * death * ((childIndex % 3) - 1) * 0.24;
        child.rotation.x += dt * death * (0.5 + childIndex * 0.07);
      }
    }
    const flash = Math.max(0, options.flash || 0);
    armorMaterial.emissive.set(flash > 0.02 ? '#ffffff' : '#23030a');
    armorMaterial.emissiveIntensity = flash > 0.02 ? Math.min(1.2, flash * 1.7) : 0.08 + wounded * 0.16;
    armorMaterial.roughness = 0.36 + wounded * 0.16;
    accentMaterial.emissiveIntensity = 0.18 + flash * 0.8 + phase * 0.045 + wounded * 0.20;
    weakMaterial.emissiveIntensity = 0.58 + Math.sin(time * (3.6 + phase * 0.5)) * 0.12;
  }

  function frame(options) {
    if (!init()) return null;
    resize(options.width | 0, options.height | 0);
    const index = Math.max(0, Math.min(5, options.index | 0));
    if (index !== current || !root) build(index);
    const frameId = window.FRAME?.frame ?? 0;
    if (frameId !== lastFrame) {
      lastFrame = frameId;
      const dt = Math.min(0.05, Math.max(0, window.FRAME?.rawDt ?? 1 / 60));
      const time = window.FRAME?.realTime ?? 0;
      fade = Math.min(1, fade + dt / 0.38);
      const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV * 0.5)) * CAMERA_Z;
      const viewW = viewH * camera.aspect;
      const radius = Math.max(16, options.radius || 64);
      root.position.set((options.x / width - 0.5) * viewW, -(options.y / height - 0.5) * viewH, 0);
      const worldRadius = radius / height * viewH;
      const death = Math.max(0, Math.min(1, options.death || 0));
      const phaseKick = options.state === 'bascule' ? 1 + Math.sin(time * 15) * 0.045 : 1;
      const entrance = 0.82 + fade * 0.18;
      root.scale.setScalar(worldRadius * entrance * phaseKick * (1 - death * 0.14));
      overlayRoot.position.copy(root.position);
      overlayRoot.scale.setScalar(worldRadius * entrance * phaseKick * (1 - death * 0.10));
      updateParts(options, radius, time);
      animate(options, dt, time);
      renderer.render(scene, camera);
    }
    const dying = options.state === 'mort' ? Math.max(0, 1 - (options.death || 0) * 0.86) : 1;
    return { canvas: renderer.domElement, alpha: fade * dying * 0.94, scale };
  }

  return { frame, isAvailable: () => init() };
})();

window.BOSS3D = BOSS3D;
