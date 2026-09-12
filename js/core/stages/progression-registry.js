const MODE_ID = /^[a-z][a-z0-9-]*$/;

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(label + ' doit etre un entier strictement positif');
  }
}

function validateProgression(id, definition) {
  if (!MODE_ID.test(id)) throw new TypeError('Identifiant de progression invalide');
  if (!definition || typeof definition !== 'object') throw new TypeError('Progression invalide');
  positiveInteger(definition.stageCount, 'stageCount');
  positiveInteger(definition.bossEvery, 'bossEvery');
  if (definition.bossEvery > definition.stageCount) {
    throw new RangeError('bossEvery ne peut pas depasser stageCount');
  }
  if (!Array.isArray(definition.themes) || definition.themes.length === 0) {
    throw new TypeError('La progression doit contenir au moins un theme');
  }
  if (!Array.isArray(definition.compositions) || definition.compositions.length === 0) {
    throw new TypeError('La progression doit contenir au moins une composition');
  }

  const themeKeys = new Set();
  for (const theme of definition.themes) {
    if (!theme || typeof theme.key !== 'string' || !theme.key) throw new TypeError('Theme invalide');
    if (themeKeys.has(theme.key)) throw new Error('Theme duplique: ' + theme.key);
    themeKeys.add(theme.key);
  }
  for (const composition of definition.compositions) {
    positiveInteger(composition.stage, 'Stage de deblocage');
    if (composition.stage > definition.stageCount) {
      throw new RangeError('Composition debloquee apres la fin du mode');
    }
  }
}

export class ProgressionRegistry {
  #definitions = new Map();

  register(modeId, definition) {
    validateProgression(modeId, definition);
    if (this.#definitions.has(modeId)) throw new Error('Progression deja enregistree: ' + modeId);
    this.#definitions.set(modeId, definition);
    return definition;
  }

  get(modeId) {
    return this.#definitions.get(modeId) || null;
  }

  list() {
    return Array.from(this.#definitions.entries(), ([id, definition]) => ({ id, definition }));
  }

  isBossStage(modeId, stage) {
    const definition = this.get(modeId);
    if (!definition) return false;
    const normalized = Math.round(stage) || 1;
    return normalized > 0 && normalized % definition.bossEvery === 0;
  }

  next(modeId, stage, loop = 0) {
    const definition = this.get(modeId);
    if (!definition) throw new Error('Progression inconnue: ' + modeId);
    const nextStage = (Math.round(stage) || 1) + 1;
    const normalizedLoop = Math.max(0, Math.round(loop) || 0);
    return nextStage > definition.stageCount
      ? { stage: 1, loop: normalizedLoop + 1 }
      : { stage: nextStage, loop: normalizedLoop };
  }
}

