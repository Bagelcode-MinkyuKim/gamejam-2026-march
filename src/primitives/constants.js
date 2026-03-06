"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CURRENCY_LABEL = exports.HUB_BOOTSTRAP_CONFIG = exports.AUDIO_MUTE_STORAGE_KEY = exports.AUDIO_ENABLED = exports.MAX_FRAME_DELTA_MS = exports.DEFAULT_FRAME_MS = exports.DEFAULT_GAME_FPS = exports.MINI_GAME_STAGE_HEIGHT = exports.MOBILE_VIEWPORT = exports.HUB_STORAGE_KEY = void 0;
exports.HUB_STORAGE_KEY = 'bagel-miniheaven-progress-v1';
exports.MOBILE_VIEWPORT = {
    width: 432,
    height: 768,
};
exports.MINI_GAME_STAGE_HEIGHT = 420;
exports.DEFAULT_GAME_FPS = 60;
exports.DEFAULT_FRAME_MS = 1000 / exports.DEFAULT_GAME_FPS;
exports.MAX_FRAME_DELTA_MS = exports.DEFAULT_FRAME_MS * 4;
exports.AUDIO_ENABLED = true;
exports.AUDIO_MUTE_STORAGE_KEY = 'bagel-miniheaven-audio-muted-v1';
exports.HUB_BOOTSTRAP_CONFIG = {
    initialCoins: 30,
    starterUnlockedGameIds: ['gogunbuntu', 'run-run', 'tap-dash'],
};
exports.CURRENCY_LABEL = 'Bagel Coin';
