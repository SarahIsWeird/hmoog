export class OogInitializationError extends Error {
    constructor(reason: string) {
        super(`Failed to initialize OOG: ${reason}`);
    }
}

export class OogNotInitializedError extends Error {
    constructor() {
        super('You need to call init() before calling other methods!');
    }
}

export class OogExecutionError extends Error {}
