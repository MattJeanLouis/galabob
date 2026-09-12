const MODE_ID = /^[a-z][a-z0-9-]*$/;

/** Registre sans dependance navigateur pour les modes de jeu de Galabob. */
export class GameModeRegistry {
  #modes = new Map();
  #activeId = null;

  register(mode) {
    if (!mode || typeof mode !== 'object') throw new TypeError('Mode invalide');
    if (!MODE_ID.test(mode.id || '')) throw new TypeError('Identifiant de mode invalide');
    if (this.#modes.has(mode.id)) throw new Error(`Mode deja enregistre : ${mode.id}`);
    this.#modes.set(mode.id, Object.freeze({ ...mode }));
    return this;
  }

  activate(id) {
    if (!this.#modes.has(id)) throw new Error(`Mode inconnu : ${id}`);
    this.#activeId = id;
    return this.current();
  }

  current() {
    return this.#activeId ? this.#modes.get(this.#activeId) : null;
  }

  list() {
    return [...this.#modes.values()];
  }

  call(hook, payload) {
    const mode = this.current();
    if (!mode || typeof mode[hook] !== 'function') return undefined;
    return mode[hook](payload);
  }
}
