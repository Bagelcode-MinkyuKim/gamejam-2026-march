"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSoundSettings = getSoundSettings;
exports.updateSoundSettings = updateSoundSettings;
exports.subscribeSoundSettings = subscribeSoundSettings;
exports.playOneShotAudio = playOneShotAudio;
exports.playBackgroundAudio = playBackgroundAudio;
exports.stopBackgroundAudio = stopBackgroundAudio;
exports.getActiveBgmTrack = getActiveBgmTrack;
var STORAGE_KEY = 'pungak-sound-settings';
var DEFAULT_SETTINGS = {
    bgmVolume: 0.7,
    sfxVolume: 0.8,
    bgmMuted: false,
    sfxMuted: false,
};
function loadSettings() {
    try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw === null)
            return __assign({}, DEFAULT_SETTINGS);
        var parsed = JSON.parse(raw);
        return {
            bgmVolume: typeof parsed.bgmVolume === 'number' ? clamp01(parsed.bgmVolume) : DEFAULT_SETTINGS.bgmVolume,
            sfxVolume: typeof parsed.sfxVolume === 'number' ? clamp01(parsed.sfxVolume) : DEFAULT_SETTINGS.sfxVolume,
            bgmMuted: typeof parsed.bgmMuted === 'boolean' ? parsed.bgmMuted : DEFAULT_SETTINGS.bgmMuted,
            sfxMuted: typeof parsed.sfxMuted === 'boolean' ? parsed.sfxMuted : DEFAULT_SETTINGS.sfxMuted,
        };
    }
    catch (_a) {
        return __assign({}, DEFAULT_SETTINGS);
    }
}
function saveSettings(settings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    catch (_a) {
        // silent — storage full or unavailable
    }
}
function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}
var currentSettings = loadSettings();
var snapshotCache = __assign({}, currentSettings);
var activeBgm = null;
var activeBgmTrack = null;
var activeBgmBaseVolume = 0;
var listeners = new Set();
function getSoundSettings() {
    return snapshotCache;
}
function updateSoundSettings(partial) {
    currentSettings = __assign(__assign(__assign({}, currentSettings), partial), { bgmVolume: partial.bgmVolume !== undefined ? clamp01(partial.bgmVolume) : currentSettings.bgmVolume, sfxVolume: partial.sfxVolume !== undefined ? clamp01(partial.sfxVolume) : currentSettings.sfxVolume });
    snapshotCache = __assign({}, currentSettings);
    saveSettings(currentSettings);
    applyBgmVolume();
    listeners.forEach(function (fn) { return fn(); });
}
function subscribeSoundSettings(fn) {
    listeners.add(fn);
    return function () { listeners.delete(fn); };
}
function effectiveBgmVolume(baseVolume) {
    if (currentSettings.bgmMuted)
        return 0;
    return baseVolume * currentSettings.bgmVolume;
}
function effectiveSfxVolume(baseVolume) {
    if (currentSettings.sfxMuted)
        return 0;
    return baseVolume * currentSettings.sfxVolume;
}
function applyBgmVolume() {
    if (activeBgm !== null) {
        activeBgm.volume = effectiveBgmVolume(activeBgmBaseVolume);
    }
}
function playOneShotAudio(src, baseVolume) {
    var vol = effectiveSfxVolume(baseVolume);
    if (vol <= 0)
        return;
    var sound = new Audio(src);
    sound.preload = 'auto';
    sound.volume = vol;
    void sound.play().catch(function () { });
}
function playBackgroundAudio(src, baseVolume) {
    if (activeBgmTrack === src && activeBgm !== null) {
        activeBgmBaseVolume = baseVolume;
        activeBgm.volume = effectiveBgmVolume(baseVolume);
        return;
    }
    stopBackgroundAudio();
    var bg = new Audio(src);
    bg.loop = true;
    bg.preload = 'auto';
    bg.volume = effectiveBgmVolume(baseVolume);
    void bg.play().catch(function () { });
    activeBgm = bg;
    activeBgmTrack = src;
    activeBgmBaseVolume = baseVolume;
}
function stopBackgroundAudio() {
    if (activeBgm !== null) {
        activeBgm.pause();
        activeBgm.currentTime = 0;
        activeBgm = null;
    }
    activeBgmTrack = null;
    activeBgmBaseVolume = 0;
}
function getActiveBgmTrack() {
    return activeBgmTrack;
}
