import Phaser from 'phaser';
import { initRapier } from '@trampa/shared';

/** Loads the Rapier WASM once, then hands off to the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    this.cameras.main.setBackgroundColor('#06070d');
    this.add
      .text(this.scale.width / 2, this.scale.height / 2 - 20, 'TRAMPA', {
        fontSize: '48px',
        color: '#38e1ff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const loading = this.add
      .text(this.scale.width / 2, this.scale.height / 2 + 30, 'cargando físicas…', {
        fontSize: '16px',
        color: '#889',
      })
      .setOrigin(0.5);

    initRapier()
      .then(() => this.game.events.emit('boot:ready'))
      .catch((err) => {
        loading.setText('error al cargar: ' + err.message);
        loading.setColor('#ff5555');
      });
  }
}
