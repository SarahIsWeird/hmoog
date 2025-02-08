import * as native from '@sarahisweird/hmoog-native';
import FileWatcher from './fileWatcher.js';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { getShellPath, popAssert, removeColors, waitMs } from './utils.js';
import { OogExecutionError, OogInitializationError, OogNotInitializedError } from './errors.js';
import { ExecutionResult, FlushReason } from './types.js';
import { FAILURE_MESSAGE, FLUSH_MESSAGE, SUCCESS_MESSAGE } from './constants.js';

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

    private didInit = false;
    private lastShellFlag: string | undefined;
    private unprocessedLines: string[] = [];

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
     * @remarks
     * The flush operation may be delayed by another program that's currently being executed,
     * in which case this function only returns when both the program and the flush command ran.
     */
    async flush(): Promise<void> {
        this.assertDidInit();

        let didCommandFlush: boolean = false;

        this.waitForCommandFlush().then(() => { didCommandFlush = true });
        await this.sendRaw('flush');
        while (!didCommandFlush) {
            native.sendKeystrokes('\n');
            await waitMs(50);
        }

        // For some reason, the delay sometimes isn't big enough. This should fix it.
        await waitMs(100);
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

        const lines: string[] = this.consumeLines();

        const echoedCommand = lines.length > 0
            ? removeColors(lines.shift()!).slice(2)
            : undefined;

        if (echoedCommand !== command) throw new OogExecutionError('Could not find the command that was sent!');

        let success: boolean | undefined;
        if ([SUCCESS_MESSAGE, FAILURE_MESSAGE].includes(lines[0])) {
            success = lines.shift() == SUCCESS_MESSAGE;
        }

        const rawText = lines.join('\n');
        const rawUncoloredText = removeColors(rawText);
        const uncoloredLines = rawUncoloredText.split('\n');

        return {
            command: command,
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
        await waitMs(20);
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
