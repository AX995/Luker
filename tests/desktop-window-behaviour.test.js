import { describe, expect, test } from '@jest/globals';
import { hidesOnClose, usesTray } from '../desktop-app/window-behaviour.js';

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
});
