/** An execution result from {@link HmOog.runCommand} */
export type ExecutionResult = {
    /** The command that was run (returned as-is) */
    command: string,
    /**
     * Whether the script ran successfully.
     *
     * Dependent on <span color="#1EFF00">SUCCESS</span> or
     * <span color="#FF0000">FAILURE</span> output,
     * undefined if neither is present.
     */
    success?: boolean,
    /** The output from the script. */
    output: {
        /** The colored output from the script. */
        colored: {
            /** The raw output from the script. */
            raw: string,
            /** The output from the script, split into lines. */
            lines: string[],
        },
        /** The output from the script with color tags removed. */
        uncolored: {
            /** The raw output from the script, but with color tags removed. */
            raw: string,
            /** The output from the script with color tags removed, split into lines. */
            lines: string[],
        },
    },
};

/** The reason the shell was flushed. */
export enum FlushReason {
    /** The game flushed the shell. */
    AUTO,
    /** The shell was flushed manually, i.e., via `flush`. */
    COMMAND,
}
