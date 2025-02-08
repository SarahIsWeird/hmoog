import { watch as watchFile } from 'node:fs/promises';

export default class FileWatcher {
    private readonly filePath: string;
    private listeners: (() => void)[] = [];
    private abortController: AbortController;

    constructor(filePath: string) {
        this.filePath = filePath;
        this.abortController = new AbortController();

        this.listen().then();
    }

    waitForChange(): Promise<void> {
        return new Promise((resolve) => {
            this.listeners.push(resolve);
        });
    }

    close() {
        this.abortController.abort();
    }

    private async listen() {
        try {
            const watcher = watchFile(this.filePath, {
                signal: this.abortController.signal,
                persistent: true,
            });

            for await (const event of watcher) {
                if (event.eventType !== 'change') continue;

                let listener;
                while (listener = this.listeners.pop()) {
                    listener();
                }
            }
        } catch (error) {
            if (!(error instanceof Error) || error.name !== 'AbortError') throw error;
        }
    }
}
