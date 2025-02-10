import * as native from '@sarahisweird/hmoog-native';
import FileWatcher from './fileWatcher.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getShellPath, popAssert, removeColors, waitMs } from './utils.js';
import { OogExecutionError, OogInitializationError, OogNotInitializedError } from './errors.js';
import { ExecutionResult, FlushReason } from './types.js';
import {
    ACTIVATING_HARDLINE_MESSAGE,
    FAILURE_MESSAGE,
    FLUSH_MESSAGE,
    GREATER_THAN_ENCODED,
    HARDLINE_ACTIVE_MESSAGE,
    HARDLINE_DISCONNECTED_MESSAGE,
    HARDLINE_RECALIBRATING_MESSAGE,
    LESS_THAN_ENCODED,
    SUCCESS_MESSAGE
} from './constants.js';

/** Options for the {@link HmOog.constructor HmOog constructor}. */
export interface OogOptions {
    /**
     * The path to the shell.txt
     * @default (the Hackmud data folder of your system)/shell.txt
     */
    shellPath: string,
    /**
     * If the Hackmud shell should be focused on startup.
     * @default false
     */
    shouldFocusShell: boolean,
}

/** The class that manages OOG activity. */
export class HmOog {
    private readonly shellPath: string;
    private readonly shouldFocusShell: boolean;
    private readonly fileWatcher: FileWatcher;

    private didInit: boolean = false;
    private lastShellFlag: string | undefined;
    private unprocessedLines: string[] = [];

    private isInHardline: boolean = false;

    /**
     * @param options Initialisation options - see {@link OogOptions}
     */
    constructor(options?: Partial<OogOptions>) {
        const defaultedOptions: OogOptions = {
            shellPath: getShellPath(),
            shouldFocusShell: true,
            ...(options || {}),
        };

        if (!native.init()) {
            throw new OogInitializationError('Could not initialize native module!');
        }

        this.shellPath = defaultedOptions.shellPath;
        this.shouldFocusShell = defaultedOptions.shouldFocusShell;
        this.fileWatcher = new FileWatcher(defaultedOptions.shellPath);
    }

    /**
     * Initialize the OOG. Must be called before any other methods!
     */
    async init(): Promise<void> {
        if (this.shouldFocusShell) {
            native.sendMouseClick(100, 100, false);
        }

        await this.updateShell();
        this.consumeLines(); // Discard old output

        this.didInit = true;
    }

    /**
     * Wait until the shell is flushed.
     *
     * @returns why the shell was flushed
     */
    async waitForFlush(): Promise<FlushReason> {
        this.assertDidInit();
        await this.fileWatcher.waitForChange();
        return await this.updateShell();
    };

    /**
     * Wait until the shell is flushed by a `flush` command.
     */
    async waitForCommandFlush(): Promise<void> {
        while (await this.waitForFlush() !== FlushReason.COMMAND) {}
    }

    /**
     * Runs the `flush` command and waits until it successfully flushed the shell.
     *
     * @param timeout=0 the maximum number of milliseconds to try flushing.
     *                  A value below 1 means no waiting.
     *
     * @returns whether or not a timeout happened.
     *
     * @remarks
     * The flush operation may be delayed by another program that's currently being executed,
     * in which case this function only returns when both the program and the flush command ran.
     */
    async flush(timeout: number = 0): Promise<boolean> {
        this.assertDidInit();

        let didCommandFlush: boolean = false;
        let didTimeout: boolean = false;

        this.waitForCommandFlush().then(() => { didCommandFlush = true });
        if (timeout > 0) {
            setTimeout(() => didTimeout = true, timeout);
        }

        await this.sendRaw('flush');
        while (!didCommandFlush && !didTimeout) {
            native.sendKeystrokes('\n');
            await waitMs(50);
        }

        // For some reason, the delay sometimes isn't big enough. This should fix it.
        await waitMs(500);
        return !didCommandFlush && didTimeout;
    }

    /**
     * Sends a command to Hackmud and processes the result.
     *
     * @param command The command to send
     * @returns The result of the command
     * @throws TypeError if the command contains newlines
     * @throws OogExecutionError if the command couldn't be typed into Hackmud
     */
    async runCommand(command: string): Promise<ExecutionResult> {
        if (!await this.sendRaw(command)) throw new OogExecutionError('Could not send command to Hackmud!');
        await this.flush();

        return this.processOutput(command);
    }

    private processOutput(ofCommand: string): ExecutionResult {
        const lines: string[] = this.consumeLines();

        let echoedCommand: string | undefined = undefined;
        while (echoedCommand !== ofCommand) {
            echoedCommand = lines.length > 0
                ? removeColors(lines.shift()!).slice(2)
                : undefined;

            if (echoedCommand === undefined) throw new OogExecutionError('Could not find the command that was sent!');
        }

        let success: boolean | undefined;
        if ([SUCCESS_MESSAGE, FAILURE_MESSAGE].includes(lines[0])) {
            success = lines.shift() == SUCCESS_MESSAGE;
        }

        const rawText = lines.join('\n');
        const rawUncoloredText = removeColors(rawText)
            .replaceAll(LESS_THAN_ENCODED, '<')
            .replaceAll(GREATER_THAN_ENCODED, '>');
        const uncoloredLines = rawUncoloredText.split('\n');

        return {
            command: ofCommand,
            success: success,
            output: {
                colored: {
                    raw: rawText,
                    lines: lines,
                },
                uncolored: {
                    raw: rawUncoloredText,
                    lines: uncoloredLines,
                },
            },
        };
    }

    /**
     * Sends a command to Hackmud.
     *
     * @param command The command to send
     * @returns whether the command could be typed into Hackmud
     * @throws TypeError if the command contains newlines
     */
    async sendRaw(command: string): Promise<boolean> {
        if (command.trim() === '') throw new TypeError('Command cannot be empty!');
        if (command.includes('\n')) throw new TypeError('Commands cannot contain newlines!');

        if (!native.sendKeystrokes(command + '\n')) return false;
        await waitMs(50);
        return true;
    }

    /**
     * Removes and returns all shell lines yet to be processed by other methods.
     *
     * @returns a list of the raw shell output
     */
    consumeLines(): string[] {
        const lines: string[] = this.unprocessedLines;
        this.unprocessedLines = [];
        return lines;
    }

    /**
     * Get the current hardline activation status.
     */
    isHardlineActive(): boolean {
        return this.isInHardline;
    }

    /**
     * Enters hardline.
     *
     * @remarks
     *
     * Due to the hardline GUI, it takes *at least* 15 seconds to enter hardline!
     * If entering hardline fails, the call takes ~2s.
     * If it succeeds, it will take over 20s!
     *
     * This delay can **not** be reduced meaningfully due to the
     * `-hardline active-` message, as well as all the animations being pretty slow.
     *
     * @returns 0 if successful, otherwise how many milliseconds are left until the next hardline.
     */
    async enterHardline(): Promise<number> {
        this.consumeLines();

        await this.sendRaw('kernel.hardline');

        // If we can flush, we can't be in the hardline!
        const didTimeout = await this.flush(3000);
        if (!didTimeout) {
            // Apparently, a flush happens before entering hardline.
            // Unsure if it's only sometimes or always,
            // but we can just check the response if we got one.
            const cooldown = this.getHardlineCooldown();
            if (cooldown > 0) return cooldown;
        }

        await waitMs(8000);

        for (let _i = 0; _i < 12; _i++) {
            native.sendKeystrokes('0123456789');
            await waitMs(10);
        }

        await waitMs(11000);

        await this.flush();
        this.consumeLines();
        return 0;
    }

    /**
     * Exits hardline.
     *
     * @remarks
     *
     * Wait five seconds after calling `kernel.hardline {dc: true}`, due to the
     * `-hardline disconnected-` message breaking parsing.
     *
     * While it could be reduced, it would also show up unexpectedly in results
     * from {@link runCommand}!
     */
    async exitHardline(): Promise<void> {
        await this.sendRaw('kernel.hardline {dc: true}');
        await waitMs(5000);
        await this.flush();
        this.consumeLines();
    }

    /**
     * Helper method to get the number of milliseconds left until the next hardline is available.
     *
     * @private
     */
    private getHardlineCooldown(): number {
        const result = this.processOutput('kernel.hardline');

        const response = result.output.colored.lines[0];
        if (response && response === ACTIVATING_HARDLINE_MESSAGE) return 0;

        if (!response || !response.startsWith(HARDLINE_RECALIBRATING_MESSAGE)) {
            const errorMessage = 'Could not enter hardline, and yet there is no recalibration message!\n'
                + 'Response from kernel.hardline:\n'
                + response;
            throw new OogExecutionError(errorMessage);
        }

        const secondsString = response.substring(HARDLINE_RECALIBRATING_MESSAGE.length + 1)
            .split(' ')[0]
            .replace('s', '');

        // Add one second, just to be sure. "0s" remaining is a thing.
        return (parseInt(secondsString) + 1) * 1000;
    }

    /**
     * Small helper method to check if {@link init} has been run.
     *
     * @private
     * @throws OogNotInitializedError if not initialized
     */
    private assertDidInit(): void {
        if (!this.didInit) throw new OogNotInitializedError();
    }

    /**
     * Sends a special flag, so we can find where we last left off.
     *
     * @remarks
     *
     * The reason we need to do this is that we can't tell apart old stuff from new stuff
     * in every case. If the outputs have been exactly the same, we'd need to guesswork.
     * This completely negates the need for guessing!
     *
     * @private
     */
    private async placeShellFlag(): Promise<void> {
        this.lastShellFlag = randomUUID().toString();
        await waitMs(500);
        await this.sendRaw(`# ${this.lastShellFlag}`);
    }

    /**
     * Helper method that searches for the previous {@link placeShellFlag shell flag} and removes everything
     * before it, including the flag itself and its error output.
     *
     * @private
     * @param lines The lines to process
     */
    private removeOldLines(lines: string[]): string[] {
        if (!this.lastShellFlag) return lines;

        const lastLineIndex = lines.findIndex(line => line.includes(this.lastShellFlag!));
        if (this.didInit && lastLineIndex === -1) throw new Error('Couldn\'t merge shell histories!');

        return lines.slice(lastLineIndex + 3);
    }

    /**
     * Reads the actual shell.txt file and puts yet unprocessed lines into {@link unprocessedLines}.
     *
     * Removes *some* junk output like any `flush` executions.
     *
     * @private
     * @returns The reason for the last shell flush
     */
    private async updateShell(): Promise<FlushReason> {
        const newContents: string = await readFile(this.shellPath, { encoding: 'utf8' });
        const lines: string[] = newContents.split('\n');

        let newLines: string[] = this.removeOldLines(lines);
        if (newLines.length === 0) return FlushReason.AUTO;

        const flushReason: FlushReason = newLines[newLines.length - 1] === FLUSH_MESSAGE
            ? FlushReason.COMMAND
            : FlushReason.AUTO;

        if (newLines.indexOf(HARDLINE_ACTIVE_MESSAGE) !== -1) {
            this.isInHardline = true;
        }

        if (newLines.indexOf(HARDLINE_DISCONNECTED_MESSAGE) !== -1) {
            this.isInHardline = false;
        }

        if (flushReason === FlushReason.AUTO) return FlushReason.AUTO;

        // :(
        newLines = newLines.filter(line =>
            (line !== HARDLINE_ACTIVE_MESSAGE) && (line !== HARDLINE_DISCONNECTED_MESSAGE));

        if (flushReason === FlushReason.COMMAND) {
            popAssert(newLines, FLUSH_MESSAGE);

            // If the last command also was a flush, this will be empty.
            if (newLines.length > 0) {
                popAssert(newLines, '');
            }
        }

        this.unprocessedLines.push(...newLines);
        await this.placeShellFlag();

        return flushReason;
    }
}
