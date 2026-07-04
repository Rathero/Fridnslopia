import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.js';
import { GameScene, type GameSceneData, type RunResult } from './scenes/GameScene.js';
import { Overlay } from './ui/overlay.js';

/**
 * Entry point. Phaser owns only Boot + Game (the pure-thumb gameplay). All
 * menus / leagues / store / results live in an HTML overlay, bridged via game
 * events so the two never fight over the pointer.
 */
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#06070d',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
  },
  render: { antialias: true, pixelArt: false },
  scene: [BootScene, GameScene],
});

const overlay = new Overlay((data: GameSceneData) => {
  game.scene.start('Game', data);
});

game.events.on('boot:ready', () => {
  overlay.showMenu();
});

game.events.on('run:finished', (result: RunResult) => {
  overlay.showResult(result);
});
