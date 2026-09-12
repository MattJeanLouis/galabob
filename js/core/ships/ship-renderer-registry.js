const RENDERER_ID = /^[a-z][a-z0-9-]*$/;

export class ShipRendererRegistry {
  #renderers = new Map();
  lastError = null;

  register(id, renderer) {
    if (!RENDERER_ID.test(id || '')) throw new TypeError('Identifiant de rendu invalide');
    if (typeof renderer !== 'function') throw new TypeError('Le rendu doit etre une fonction');
    if (this.#renderers.has(id)) throw new Error('Rendu deja enregistre: ' + id);
    this.#renderers.set(id, renderer);
    return this;
  }

  get(id) {
    return this.#renderers.get(id) || null;
  }

  draw(id, context, state) {
    const renderer = this.get(id);
    if (!renderer) return false;
    try {
      renderer(context, state);
      this.lastError = null;
      return true;
    } catch (error) {
      this.lastError = error;
      return false;
    }
  }
}
