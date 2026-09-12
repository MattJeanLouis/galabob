(function installPowerUpCatalogue(global) {
  const definitions = [
    {
      key: 'double', label: 'DOUBLE', letter: 'D', slot: 'weapon',
      color: 'powerup.double', shape: { kind: 'poly', sides: 6, rot: 0 },
      weight: 15, duration: null, pips: 3
    },
    {
      key: 'spread', label: 'SPREAD', letter: 'S', slot: 'weapon',
      color: 'powerup.spread', shape: { kind: 'poly', sides: 3, rot: Math.PI / 2 },
      weight: 15, duration: null, pips: 3
    },
    {
      key: 'laser', label: 'LASER', letter: 'L', slot: 'weapon',
      color: '#ff4df0',
      shape: { kind: 'poly', sides: 4, rot: -Math.PI / 2, sx: 0.60, sy: 1.28 },
      weight: 6, duration: null, pips: 2, rare: true
    },
    {
      key: 'missiles', label: 'MISSILES', letter: 'M', slot: 'weapon',
      color: '#ff9d3d', shape: { kind: 'poly', sides: 5, rot: -Math.PI / 2 },
      weight: 9, duration: null, pips: 3
    },
    {
      key: 'mitraille', label: 'MITRAILLE', letter: 'R', slot: 'weapon',
      color: '#a6ff3d', shape: { kind: 'poly', sides: 8, rot: Math.PI / 8 },
      weight: 11, duration: null, pips: 4
    },
    {
      key: 'onde', label: 'ONDE', letter: 'O', slot: 'weapon',
      color: '#4db8ff', shape: { kind: 'poly', sides: 20, rot: 0 },
      weight: 10, duration: null, pips: 2
    },
    {
      key: 'bouclier', label: 'BOUCLIER', letter: 'B', slot: 'shield',
      color: '#8affff', shape: { kind: 'shield' },
      weight: 12, duration: 0, charges: 1, pips: 3
    },
    {
      key: 'ralenti', label: 'RALENTI', letter: 'T', slot: 'mod',
      color: '#6f7dff', shape: { kind: 'hourglass' },
      weight: 4, duration: 3000, pips: 2, rare: true
    },
    {
      key: 'bombe', label: 'BOMBE', letter: '!', slot: 'instant',
      color: '#ffffff', shape: { kind: 'poly', sides: 14, rot: 0, rays: 8 },
      weight: 3, duration: 0, pips: 4, rare: true, impact: 1.9
    },
    {
      key: 'surcharge', label: 'SURCHARGE', letter: 'U', slot: 'mod',
      color: '#c86bff', shape: { kind: 'star', points: 8, inner: 0.58, rot: 0 },
      weight: 5, duration: 5000, pips: 0, rare: true, impact: 1.4
    },
    {
      key: 'aimant', label: 'AIMANT', letter: 'A', slot: 'mod',
      color: '#ff6ec7', shape: { kind: 'magnet' },
      weight: 8, duration: 12000, pips: 2
    },
    {
      key: 'multiplicateur', label: '×2 POINTS', letter: 'X', slot: 'mod',
      color: '#ffee55', shape: { kind: 'star', points: 4, inner: 0.40, rot: -Math.PI / 2 },
      weight: 8, duration: 10000, pips: 4
    },
    {
      key: 'life', label: '+1 VIE', letter: '+', slot: 'instant',
      color: 'powerup.life', shape: { kind: 'cross' },
      weight: 3, duration: 0, pips: 4, rare: true, impact: 1.6
    },
    {
      key: 'forteresse', label: 'FORTERESSE', letter: 'F', slot: 'shield',
      color: '#62f3ff', shape: { kind: 'shield' },
      weight: 4, duration: 0, charges: 2, pips: 5, rare: true, impact: 1.35
    },
    {
      key: 'furie', label: 'FURIE', letter: 'Z', slot: 'mod',
      color: '#ff405f', shape: { kind: 'star', points: 6, inner: 0.46, rot: 0 },
      weight: 5, duration: 8000, pips: 3, rare: true, impact: 1.25
    },
    {
      key: 'arsenal', label: 'ARSENAL', letter: 'C', slot: 'instant',
      color: '#ffb13d', shape: { kind: 'poly', sides: 8, rot: Math.PI / 8 },
      weight: 2, duration: 0, effectDuration: 12000, pips: 6, rare: true, impact: 1.8
    }
  ];

  const aliases = {
    vie: 'life', extralife: 'life', heart: 'life',
    shield: 'bouclier', bouclier: 'bouclier',
    slow: 'ralenti', slowmo: 'ralenti', bullettime: 'ralenti',
    magnet: 'aimant',
    multi: 'multiplicateur', x2: 'multiplicateur', score: 'multiplicateur',
    overdrive: 'surcharge', overload: 'surcharge',
    bomb: 'bombe', smart: 'bombe',
    missile: 'missiles', homing: 'missiles',
    wave: 'onde', ondulation: 'onde',
    rapid: 'mitraille', gatling: 'mitraille', rafale: 'mitraille',
    beam: 'laser'
  };

  for (const definition of definitions) {
    Object.freeze(definition.shape);
    Object.freeze(definition);
  }
  global.GALABOB_POWER_UP_CATALOGUE = Object.freeze(definitions);
  global.GALABOB_POWER_UP_ALIASES = Object.freeze(aliases);
})(window);
