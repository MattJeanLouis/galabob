/** Mode de tir délibéré à chargeur et boutique, inspiré de Titan Attacks. */
export function createAssaultMode(progression) {
  const extensionWeapons = ['double'];
  const ammoWeapons = ['spread', 'missiles', 'onde'];
  const allDropWeapons = [...ammoWeapons];
  const state = {
    credits: 0, shopOpen: false, stage: 1, message: '',
    magazine: 2, magazineMax: 2,
    reloadRemaining: 0, reloadDuration: 1250,
    damageLevel: 0, weaponPurchases: 0,
    salvageLevel: 0, scannerLevel: 0, ammoLevel: 0,
    bonusTimer: 9500,
    extensions: { double: false },
    offers: [], refreshCount: 0, shopRevision: 0,
    routes: [], selectedRoute: null, activeRoute: null,
    ammo: { double: 0, spread: 0, missiles: 0, onde: 0 }
  };

  function announce(text, sub = '', duration = 1400) {
    if (typeof window.hudAlert === 'function') window.hudAlert(text, sub, '#ffee55', duration);
  }

  function offerPool() {
    const pool = [
      { id: 'damage', kind: 'offense', rarity: 'RARE', label: 'CONDENSATEUR', detail: 'DÉGÂTS DU CANON', delta: '+20 %', cost: 120 + state.damageLevel * 70, available: state.damageLevel < 6 },
      { id: 'double', kind: 'offense', rarity: 'ÉPIQUE', label: 'CANONS JUMELÉS', detail: 'DOUBLE TIR PERMANENT', delta: '2 PROJECTILES', cost: 240, available: !state.extensions.double },
      { id: 'magazine', kind: 'utility', rarity: 'STANDARD', label: 'MAGASIN ÉTENDU', detail: 'CAPACITÉ DU CHARGEUR', delta: state.magazineMax + ' → ' + (state.magazineMax + 1), cost: 100 + (state.magazineMax - 2) * 55, available: state.magazineMax < 8 },
      { id: 'reload', kind: 'utility', rarity: 'RARE', label: 'CULASSE TITANE', detail: 'TEMPS DE RECHARGE', delta: '-12 %', cost: 110 + Math.round((1250 - state.reloadDuration) * 0.16), available: state.reloadDuration > 560 },
      { id: 'shield', kind: 'defense', rarity: 'STANDARD', label: 'CELLULE AEGIS', detail: 'CHARGE DE BOUCLIER', delta: '+1', cost: 90 },
      { id: 'life', kind: 'defense', rarity: 'ÉPIQUE', label: 'COQUE DE SECOURS', detail: 'VIE SUPPLÉMENTAIRE', delta: '+1 VIE', cost: 210, available: (window.player?.lives || 0) < 5 },
      { id: 'salvage', kind: 'utility', rarity: 'RARE', label: 'PROTOCOLE PRIME', detail: 'CRÉDITS PAR ÉLIMINATION', delta: '+15 %', cost: 125 + state.salvageLevel * 75, available: state.salvageLevel < 5 },
      { id: 'scanner', kind: 'utility', rarity: 'RARE', label: 'SCANNER DE BUTIN', detail: 'CHANCE DE DROP D’ARME', delta: '+0,8 %', cost: 145 + state.scannerLevel * 80, available: state.scannerLevel < 4 },
      { id: 'ammo_payload', kind: 'utility', rarity: 'ÉPIQUE', label: 'CHARGEUR LOGISTIQUE', detail: 'MUNITIONS PAR DROP', delta: '+2', cost: 165 + state.ammoLevel * 85, available: state.ammoLevel < 4 }
    ];
    return pool.filter(offer => offer.available !== false);
  }

  function rollOffers() {
    const previous = state.offers.map(offer => offer.id).sort().join('|');
    const pool = offerPool().slice();
    const rolled = [];
    while (rolled.length < 3 && pool.length) {
      const index = Math.floor(Math.random() * pool.length);
      rolled.push({ ...pool.splice(index, 1)[0], sold: false });
    }
    const signature = rolled.map(offer => offer.id).sort().join('|');
    if (signature === previous && pool.length && rolled.length) {
      const fresh = pool.find(offer => !state.offers.some(old => old.id === offer.id)) || pool[0];
      rolled[rolled.length - 1] = { ...fresh, sold: false };
    }
    state.offers = rolled;
    state.shopRevision++;
    return state.offers;
  }

  function shopOffers() {
    return state.offers;
  }

  function refreshCost() {
    return 30 + state.refreshCount * 20;
  }

  function refreshShop() {
    if (!state.shopOpen) return false;
    const cost = refreshCost();
    if (state.credits < cost) {
      state.message = 'CRÉDITS INSUFFISANTS POUR RELANCER LE SCAN';
      return false;
    }
    state.credits -= cost;
    state.refreshCount++;
    rollOffers();
    state.message = 'NOUVEL ARRIVAGE DÉTECTÉ';
    if (window.JUICE) {
      window.JUICE.shake(0.08);
      window.JUICE.flash('#7df9ff', 140, 0.12);
    }
    return true;
  }

  const routePool = [
    { id: 'salvage', label: 'ZONE DE RÉCUPÉRATION', detail: '+30 % CR AU PROCHAIN SECTEUR', color: 'combo' },
    { id: 'armory', label: 'ARSENAL ABANDONNÉ', detail: '+2 % CHANCE DE DROP D’ARME', color: 'player' },
    { id: 'aegis', label: 'COULOIR BLINDÉ', detail: '+1 BOUCLIER À L’ENTRÉE', color: 'playerShield' },
    { id: 'bounty', label: 'TRAQUE PRIORITAIRE', detail: 'CONVOYEUR BONUS PLUS FRÉQUENT', color: 'enemyFast' }
  ];

  function rollRoutes() {
    const pool = routePool.slice();
    state.routes = [];
    while (state.routes.length < 2) {
      state.routes.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
  }

  function chooseRoute(id) {
    const route = state.routes.find(item => item.id === id);
    if (!state.shopOpen || !route) return false;
    state.selectedRoute = route;
    state.message = 'ROUTE VERROUILLÉE · ' + route.label;
    return true;
  }

  function equipSpecialWeapon(type) {
    if (!window.player || typeof window.setPlayerWeapon !== 'function') return;
    window.player.weapons = {};
    window.player.weapon = 'normal';
    window.setPlayerWeapon(type, 3600000);
  }

  function equipExtensions() {
    if (!window.player || typeof window.setPlayerWeapon !== 'function') return;
    window.player.weapons = {};
    window.player.weapon = 'normal';
    for (const type of extensionWeapons) {
      if (state.extensions[type]) window.setPlayerWeapon(type, 3600000);
    }
  }

  function fallBackToCannon() {
    equipExtensions();
    if (!window.player || window.player.weapon !== 'normal') return;
    window.player.weaponLevel = 1;
    window.player.weaponTimer = 0;
  }

  function purchase(id) {
    if (!state.shopOpen) return false;
    const offer = shopOffers().find(item => item.id === id && !item.sold);
    if (!offer) return false;
    if (state.credits < offer.cost) {
      state.message = 'CRÉDITS INSUFFISANTS';
      return false;
    }

    state.credits -= offer.cost;
    if (id === 'damage') {
      state.damageLevel = Math.min(6, state.damageLevel + 1);
    } else if (id === 'magazine') {
      state.magazineMax = Math.min(8, state.magazineMax + 1);
      state.magazine = state.magazineMax;
    } else if (id === 'reload') {
      state.reloadDuration = Math.max(560, Math.round(state.reloadDuration * 0.88));
    } else if (id === 'shield' && typeof window.addPlayerShield === 'function') {
      window.addPlayerShield(1);
    } else if (id === 'life' && window.player) {
      window.player.lives = Math.min(5, (window.player.lives || 0) + 1);
    } else if (id === 'salvage') {
      state.salvageLevel++;
    } else if (id === 'scanner') {
      state.scannerLevel++;
    } else if (id === 'ammo_payload') {
      state.ammoLevel++;
    } else if (id === 'double') {
      state.extensions.double = true;
      equipExtensions();
    }
    offer.sold = true;
    state.message = 'INSTALLÉ · ' + offer.label + ' · ' + offer.delta;
    if (window.JUICE) {
      window.JUICE.preset('powerUp', offer.rarity === 'ÉPIQUE' ? 2.2 : 1.45);
      window.JUICE.punch(offer.rarity === 'ÉPIQUE' ? 0.026 : 0.014);
    }
    if (typeof window.gameEvent === 'function') window.gameEvent('powerUp', { type: offer.id });
    return true;
  }

  return {
    id: 'assault', label: 'Assaut', hasScore: true, hasEndlessLoops: true,
    randomPowerUps: false, weaponTimers: false, progression,

    startRun() {
      state.credits = 0;
      state.shopOpen = false;
      state.stage = 1;
      state.message = '';
      state.magazine = state.magazineMax = 2;
      state.reloadRemaining = 0;
      state.reloadDuration = 1250;
      state.damageLevel = 0;
      state.weaponPurchases = 0;
      state.salvageLevel = state.scannerLevel = state.ammoLevel = 0;
      state.bonusTimer = 9500;
      for (const weapon of extensionWeapons) state.extensions[weapon] = false;
      state.offers = [];
      state.routes = [];
      state.selectedRoute = state.activeRoute = null;
      state.refreshCount = 0;
      for (const weapon of ammoWeapons) state.ammo[weapon] = 0;
      announce('MODE ASSAUT', 'TIR MAINTENU · DEUX COUPS · RECHARGE', 1800);
    },

    startStage(payload) {
      state.stage = payload?.stage || 1;
      state.activeRoute = state.selectedRoute;
      state.selectedRoute = null;
      if (state.activeRoute?.id === 'aegis' && typeof window.addPlayerShield === 'function') {
        window.addPlayerShield(1);
      }
      const acts = ['CONTACT', 'PRESSION', 'ENCERCLEMENT', 'BRÈCHE', 'COMMANDANT'];
      const act = acts[(state.stage - 1) % acts.length];
      if (window.BACKDROP && typeof window.BACKDROP.setTheme === 'function') {
        window.BACKDROP.setTheme((state.stage * 3 + 4) % 10);
      }
      let briefing = 'LA LIGNE ENNEMIE DESCEND';
      if (state.stage === 1) briefing = 'FLÈCHES OU ZQSD · MAINTENEZ ESPACE POUR TIRER';
      else if (state.stage === 3) briefing = 'NOUVELLE MENACE · SNIPERS LONGUE PORTÉE';
      else if (state.stage === 5) briefing = 'NOUVELLE MENACE · UNITÉS BLINDÉES';
      else if (state.stage % 10 === 0) briefing = 'SIGNATURE DE BOSS DÉTECTÉE';
      announce('SECTEUR ' + state.stage + ' · ' + act, briefing, 1500);
    },

    update(deltaMs) {
      const elapsed = Math.max(0, Number(deltaMs) || 0);
      state.bonusTimer -= elapsed;
      if (state.bonusTimer <= 0 && typeof window.spawnBonusEnemy === 'function') {
        if (window.spawnBonusEnemy()) {
          state.bonusTimer = state.activeRoute?.id === 'bounty'
            ? 10500 + Math.random() * 5500
            : 17000 + Math.random() * 9000;
        }
        else state.bonusTimer = 2500;
      }
      if (state.reloadRemaining <= 0) return;
      state.reloadRemaining = Math.max(0, state.reloadRemaining - elapsed);
      if (state.reloadRemaining === 0) state.magazine = state.magazineMax;
    },

    requestShot(weapon) {
      if (state.reloadRemaining > 0) return false;
      const type = weapon || 'normal';
      if (ammoWeapons.indexOf(type) >= 0) {
        if (!(state.ammo[type] > 0)) {
          state.message = 'MUNITIONS ' + type.toUpperCase() + ' ÉPUISÉES';
          fallBackToCannon();
          return false;
        }
        state.ammo[type]--;
        return true;
      }
      if (state.magazine <= 0) {
        state.reloadRemaining = state.reloadDuration;
        return false;
      }
      state.magazine--;
      if (state.magazine === 0) state.reloadRemaining = state.reloadDuration;
      return true;
    },

    adjustFireInterval() { return 235; },
    // Le premier contact sert d'entrée en matière : chaque cible tombe en un
    // impact. Dès le secteur suivant, l'amélioration du canon reprend son rôle.
    damageMultiplier() {
      const base = state.stage === 1 ? 1 : 0.42;
      return base + state.damageLevel * 0.20;
    },

    enemyKilled(payload) {
      const routeMult = state.activeRoute?.id === 'salvage' ? 1.30 : 1;
      const gain = Math.max(1, Math.round((payload?.basePoints || 10) * 0.36 * (1 + state.salvageLevel * 0.15) * routeMult));
      state.credits += gain;
      return { credits: gain };
    },

    rollEnemyDrop(payload) {
      // Le butin de combat reste une bonne surprise : l'arsenal doit demeurer
      // la source principale de progression et non une option dispensable.
      const chance = 0.012 + state.scannerLevel * 0.008 +
        (state.activeRoute?.id === 'armory' ? 0.02 : 0);
      if ((payload?.roll ?? 1) >= chance) return null;
      const index = Math.floor((payload?.pick ?? Math.random()) * allDropWeapons.length);
      return allDropWeapons[Math.min(allDropWeapons.length - 1, index)];
    },

    collectPowerUp(payload) {
      const type = payload?.definition?.key;
      if (extensionWeapons.indexOf(type) >= 0) {
        // Sécurité pour un module déjà présent à l'écran lors d'une mise à
        // jour : le double tir ne peut jamais être obtenu hors de la boutique.
        state.credits += 10;
        return { handled: true, label: 'MODULE RECYCLÉ · +10 CR' };
      }
      if (ammoWeapons.indexOf(type) >= 0) {
        const base = type === 'spread' ? 12 : type === 'missiles' ? 10 : 7;
        const amount = base + state.ammoLevel * 2;
        state.ammo[type] += amount;
        equipSpecialWeapon(type);
        return { handled: true, label: type.toUpperCase() + ' · ' + amount + ' MUNITIONS' };
      }
      return { handled: false };
    },

    bonusEnemyKilled(payload) {
      if ((payload?.roll ?? Math.random()) < 0.18) {
        const index = Math.floor((payload?.pick ?? Math.random()) * allDropWeapons.length);
        return { powerUp: allDropWeapons[Math.min(allDropWeapons.length - 1, index)] };
      }
      const gain = 35 + state.stage * 4;
      state.credits += gain;
      return { credits: gain };
    },

    completeStage(payload) {
      state.credits += 25 + (payload?.stage || 1) * 3;
      state.stage = payload?.stage || 1;
      state.shopOpen = true;
      state.refreshCount = 0;
      rollOffers();
      rollRoutes();
      state.reloadRemaining = 0;
      state.magazine = state.magazineMax;
      fallBackToCannon();
      state.message = 'CHOISISSEZ VOS AMÉLIORATIONS OU GARDEZ VOS CRÉDITS';
      return { openShop: true };
    },

    endRun() {},
    getState() { return state; },
    getShopOffers: shopOffers,
    getRefreshCost: refreshCost,
    refreshShop,
    purchase,
    chooseRoute,
    updateShop(deltaMs) {
      const elapsed = Math.max(0, Number(deltaMs) || 0);
      if (state.reloadRemaining > 0) {
        state.reloadRemaining = Math.max(0, state.reloadRemaining - elapsed);
        if (state.reloadRemaining === 0) state.magazine = state.magazineMax;
      }
    },
    closeShop() { state.shopOpen = false; state.message = ''; }
  };
}
