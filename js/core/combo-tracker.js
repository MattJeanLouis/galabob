/**
 * Etat pur de la chaine de combo.
 *
 * Le tracker ne connait ni le DOM, ni le rendu, ni l'horloge murale. Son temps
 * avance uniquement avec le delta de JEU fourni par la boucle principale : une
 * pause ou un hitstop ne peuvent donc plus consommer la fenetre du combo.
 */
export class ComboTracker {
  constructor({ windowMs, maximum }) {
    if (!(windowMs > 0)) throw new TypeError('windowMs doit etre positif');
    if (!(maximum >= 1)) throw new TypeError('maximum doit etre au moins 1');
    this.windowMs = windowMs;
    this.maximum = Math.floor(maximum);
    this.reset();
  }

  reset() {
    this.count = 0;
    this.remainingMs = 0;
  }

  step(deltaMs) {
    if (!(deltaMs > 0) || this.count === 0) return this.count;
    this.remainingMs = Math.max(0, this.remainingMs - deltaMs);
    if (this.remainingMs === 0) this.count = 0;
    return this.count;
  }

  registerKill() {
    this.count = this.count > 0 && this.remainingMs > 0 ? this.count + 1 : 1;
    this.remainingMs = this.windowMs;
    return this.count;
  }

  multiplier() {
    return Math.max(1, Math.min(this.count || 1, this.maximum));
  }

  fraction() {
    if (this.count === 0) return 0;
    return Math.max(0, Math.min(1, this.remainingMs / this.windowMs));
  }
}
