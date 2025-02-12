import process from 'node:process';
import { join as joinPath } from 'path';
import { OogInitializationError } from './errors.js';

/**
 * Gets the shell.txt path for the current system.
 */
export const getShellPath = (): string => {
    let hackmudPath: string;
    switch (process.platform) {
        case 'win32':
            hackmudPath = joinPath(process.env.APPDATA!, 'hackmud');
            break;
        default:
            throw new OogInitializationError(`Unsupported platform ${process.platform}! Please yell at Sarah.`);
    }

    return joinPath(hackmudPath, 'shell.txt');
};

/**
 * Sleep for a specified time.
 * @param ms The number of milliseconds to sleep for.
 */
export const waitMs = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper method that removes color tags from a string.
 * @param str The string to remove colors from
 */
export const removeColors = (str: string): string => {
    const colorRegex = /<color=#[0-9A-F]{8}>/g;
    return str.replaceAll(colorRegex, '')
        .replaceAll('</color>', '');
};

/**
 * Helper method to pop expected values from a list, printing a warning if it's something else.
 *
 * @param arr The array to pop from
 * @param expected The expected value
 */
export const popAssert = <T>(arr: T[], expected: T): void => {
    const poopedValue = arr.pop();
    if (poopedValue === expected) return;

    console.warn(`Expected to remove ${expected}, but it actually was ${poopedValue}?`);
    if (poopedValue !== undefined) {
        console.warn('Pushing it back, just to be safe.');
        arr.push(poopedValue);
    }
};
