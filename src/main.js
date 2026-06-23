import { GameUIController } from './ui/GameUIController.js';

new GameUIController();

if (import.meta.env.DEV) {
  import('./dev/agentation.js');
}
