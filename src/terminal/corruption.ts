export const corruptionCharReplacements = {
    // Corruption chars (=> Unicode block elements)
    '\xa1': '\u2588',
    '\xa2': '\u2596',
    '\xa4': '\u2599',
    '\xa6': '\u259b',
    '\xa7': '\u259e',
    '\xa8': '\u259f',
    '\xa9': '\u2597',
    '\xaa': '\u259c',
    '\xc1': '\u259a',
    '\xc3': '\u259d',
};

export type CorruptionChar = keyof typeof corruptionCharReplacements;
export const isCorruptionChar = (c: string): c is CorruptionChar =>
    Object.keys(corruptionCharReplacements).includes(c);

export type CorruptionReplacementTable = Record<CorruptionChar, string>;
