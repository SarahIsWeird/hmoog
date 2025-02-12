import { getShellPath, removeColors, waitMs } from './utils.js';
import * as native from '@sarahisweird/hmoog-native';
import FileWatcher from './fileWatcher.js';
import { readFile } from 'node:fs/promises';
import {
    ACTIVATING_HARDLINE_MESSAGE,
    FAILURE_MESSAGE,
    FLUSH_MESSAGE,
    GREATER_THAN_ENCODED,
    HARDLINE_ACTIVE_MESSAGE,
    HARDLINE_ALREADY_ACTIVE_MESSAGE,
    HARDLINE_DISCONNECTED_MESSAGE,
    HARDLINE_RECALIBRATING_MESSAGE,
    LESS_THAN_ENCODED,
    NO_HARDLINES_AVAILABLE_MESSAGE,
    SUCCESS_MESSAGE
} from './constants.js';
import { ExecutionResult } from './types.js';

const sendCommand = async (command: string): Promise<boolean> => {
    if (!native.sendKeystrokes(command + '\n')) return false;
    await waitMs(50);
    return true;
}

export class HmOog {
    readonly #shellPath: string;
    readonly #fileWatcher: FileWatcher;

    #lastCommand?: string;
    #isInHardline: boolean = false;

    constructor(path?: string) {
        this.#shellPath = path ?? getShellPath();
        this.#fileWatcher = new FileWatcher(this.#shellPath);
    }

    async init() {
        if (!native.init()) {
            throw new Error('Failed to initialize hmoog-native!');
        }

        native.sendMouseClick(100, 100, false);
        native.sendEscape();

        await this.#flush();
    }

    async run(command: string, timeout: number = 0, idempotent: boolean = true): Promise<ExecutionResult | null> {
        let data: string[] | null = null;
        let didReallyTimeout = false;

        if (timeout) {
            waitMs(timeout).then(() => didReallyTimeout = true);
        }

        while (data === null) {
            if (!await sendCommand(command)) {
                throw new Error('Failed to send command via hmoog-native.');
            }

            await waitMs(500);

            this.#lastCommand = command;
            data = await this.#flush(timeout);
            this.#lastCommand = undefined;

            if (data) break;

            if (didReallyTimeout) {
                console.warn(`Execution of command timed out after ${timeout}ms.`);
                return null;
            }

            if (!idempotent) {
                console.warn('Couldn\'t get a result for some reason! Since the command is not idempotent,' +
                    ' the command isn\'t tried again. Trying to recover the state.')
                await waitMs(5000);
                native.sendEscape();

                return null;
            }

            // We can try again, but we still need to try to get back to a defined state.
            await waitMs(1000);
            native.sendEscape();
        }

        return this.#postProcess(command, data);
    }

    async enterHardline(): Promise<number> {
        await sendCommand('kernel.hardline');
        await waitMs(50);

        const lines = await this.#flush(3000);
        if (lines) {
            const result = this.#postProcess('kernel.hardline', lines);
            const cooldown = this.#getHardlineCooldown(result);
            console.log(cooldown);
            if (cooldown < 0) return 0;
            if (cooldown > 0) return cooldown;
        }

        await waitMs(10000);

        for (let i = 0; i < 12; i++) {
            await sendCommand('0123456789');
        }

        await waitMs(15000);

        // Ensure that if we didn't manage to send the flush beforehand, it doesn't
        // sit in the shell still.
        native.sendKeystrokes('\n');

        this.#isInHardline = true;

        return 0;
    }

    /**
     * Alias for {@link exitHardline}.
     */
    async enterRecon(): Promise<boolean> {
        return this.exitHardline();
    }

    async exitHardline(): Promise<boolean> {
        const exitCommand = 'kernel.hardline { dc: true }';
        await sendCommand(exitCommand);
        await waitMs(5000);

        const data = await this.#flush();
        const result = this.#postProcess(exitCommand, data!);

        const success = result.output.colored.raw.includes(HARDLINE_DISCONNECTED_MESSAGE);
        if (success) {
            this.#isInHardline = false;
        }

        return success;
    }

    isInHardline() {
        return this.#isInHardline;
    }

    #getHardlineCooldown(result: ExecutionResult): number {
        const lines = result.output.colored.lines;
        if (lines.includes(ACTIVATING_HARDLINE_MESSAGE)) return 0;

        let cooldownMessage: string;

        const notAvailableIndex = lines.findLastIndex(line => line.includes(NO_HARDLINES_AVAILABLE_MESSAGE));
        const recalibratingIndex = lines.findLastIndex(line => line.includes(HARDLINE_RECALIBRATING_MESSAGE));
        const alreadyActiveIndex = lines.findLastIndex(line => line.includes(HARDLINE_ALREADY_ACTIVE_MESSAGE));

        if (alreadyActiveIndex !== -1) {
            return -1;
        } else if (notAvailableIndex !== -1) {
            cooldownMessage = lines[notAvailableIndex]
                .substring(NO_HARDLINES_AVAILABLE_MESSAGE.length);
        } else if (recalibratingIndex !== -1) {
            cooldownMessage = lines[recalibratingIndex]
                .substring(HARDLINE_RECALIBRATING_MESSAGE.length);
        } else {
            // Tentatively going to assume that this is means it succeeded, but we didn't flush
            return 0;
        }

        const secondsString = cooldownMessage.substring(1).split(' ')[0].replace('s', '');
        return (parseInt(secondsString) + 1) * 1000;
    }

    #postProcess(command: string, lines: string[]): ExecutionResult {
        let success: boolean | undefined;
        if (lines.indexOf(SUCCESS_MESSAGE) !== -1) {
            success = true;
        } else if (lines.indexOf(FAILURE_MESSAGE) !== -1) {
            success = false;
        }

        const lastCommandIndex = lines.findLastIndex(line =>
            removeColors(line) === `>>${command}`);
        if (lastCommandIndex !== -1) {
            lines = lines.slice(lastCommandIndex);
        }

        const rawText = lines.join('\n');
        const uncoloredText = removeColors(rawText)
            .replaceAll(LESS_THAN_ENCODED, '<')
            .replaceAll(GREATER_THAN_ENCODED, '>');
        const uncoloredLines = uncoloredText.split('\n');

        return {
            command: command,
            success: success,
            output: {
                colored: {
                    raw: rawText,
                    lines: lines,
                },
                uncolored: {
                    raw: uncoloredText,
                    lines: uncoloredLines,
                },
            },
        };
    }

    async #flush(timeout: number = 0): Promise<string[] | null> {
        let didTimeout: boolean = false;
        let didFlush: boolean = false;

        this.#fileWatcher.waitForChange().then(() => didFlush = true);

        if (timeout <= 0) timeout = 10000;
        waitMs(timeout).then(() => didTimeout = true);

        await sendCommand('flush');

        while (!didTimeout && !didFlush) {
            native.sendKeystrokes('\n');
            await waitMs(50);
        }

        if (didTimeout) return null;

        return await this.#readShell();
    }

    async #readShell(): Promise<string[] | null> {
        const contents = await readFile(this.#shellPath, { encoding: 'utf-8' });
        const lines = contents.split('\n');

        const lastHardlineDisconnectedIndex = lines.lastIndexOf(HARDLINE_DISCONNECTED_MESSAGE);
        const lastHardlineActiveIndex = lines.lastIndexOf(HARDLINE_ACTIVE_MESSAGE);

        if (lastHardlineDisconnectedIndex > lastHardlineActiveIndex) {
            this.#isInHardline = false;
        }

        if (!this.#lastCommand) return lines;

        const enteredCommand = this.#lastCommand
            .replaceAll('<', LESS_THAN_ENCODED)
            .replaceAll('>', GREATER_THAN_ENCODED);

        const lastCommandIndex = lines.findLastIndex(line =>
            removeColors(line) === `>>${enteredCommand}`);
        if (lastCommandIndex === -1) return null;

        const lastFlushIndex = lines.lastIndexOf(FLUSH_MESSAGE);
        if (lastFlushIndex < lastCommandIndex) return null;

        return lines.slice(lastCommandIndex + 1, lastFlushIndex);
    }
}
