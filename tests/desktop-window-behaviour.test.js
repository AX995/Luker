import { describe, expect, test } from '@jest/globals';
import { hidesOnClose, usesTray, devtoolsShortcutFor } from '../desktop-app/window-behaviour.js';

describe('desktop window behaviour per platform', () => {
    test('hides on close everywhere the app has a way back', () => {
        expect(hidesOnClose('darwin')).toBe(true);
        expect(hidesOnClose('win32')).toBe(true);
    });

    test('quits on close where nothing could bring the window back', () => {
        expect(hidesOnClose('linux')).toBe(false);
    });

    test('only windows gets a tray', () => {
        expect(usesTray('win32')).toBe(true);
        expect(usesTray('linux')).toBe(false);
        expect(usesTray('darwin')).toBe(false);
    });

    test('windows and linux toggle devtools on F12 or Ctrl+Shift+I', () => {
        expect(devtoolsShortcutFor('win32', { key: 'F12' })).toBe('toggle');
        expect(devtoolsShortcutFor('linux', { key: 'F12' })).toBe('toggle');
        expect(devtoolsShortcutFor('win32', { key: 'i', control: true, shift: true })).toBe('toggle');
        expect(devtoolsShortcutFor('linux', { key: 'i', control: true, shift: true })).toBe('toggle');
    });

    test('darwin leaves the shortcut to the application menu', () => {
        expect(devtoolsShortcutFor('darwin', { key: 'F12' })).toBe(null);
        expect(devtoolsShortcutFor('darwin', { key: 'i', control: true, shift: true })).toBe(null);
    });

    test('unrelated keys do not toggle', () => {
        expect(devtoolsShortcutFor('win32', { key: 'i' })).toBe(null);
        expect(devtoolsShortcutFor('win32', { key: 'i', control: true })).toBe(null);
        expect(devtoolsShortcutFor('win32', { key: 'j', control: true, shift: true })).toBe(null);
    });
});
