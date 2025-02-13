import { ColorNode, Node, NodeVisitor, TextNode } from './types.js';
import { ColorDepth, defaultTextColorHex, defaultTextColorRgba, vgaTranslationTable } from './colors.js';
import { corruptionCharReplacements, CorruptionReplacementTable, isCorruptionChar } from './corruption.js';
import { ShellParser } from './parsing.js';

export type AnsiConverterOptions = {
    colorDepth: ColorDepth,
    replaceCorruption: boolean,
    corruptionReplacements: CorruptionReplacementTable,
};

export class AnsiConverter extends NodeVisitor {
    private readonly colorDepth: ColorDepth;
    private readonly replaceCorruption: boolean;
    private readonly corruptionReplacements: CorruptionReplacementTable;

    private readonly colorStack: string[] = [];
    private result: string = '';

    constructor(options?: Partial<AnsiConverterOptions>) {
        super();

        const defaultedOptions: AnsiConverterOptions = {
            colorDepth: ColorDepth.TRUE_COLOR,
            replaceCorruption: true,
            corruptionReplacements: corruptionCharReplacements,
            ...options
        };

        this.colorDepth = defaultedOptions.colorDepth;
        this.replaceCorruption = defaultedOptions.replaceCorruption;
        this.corruptionReplacements = defaultedOptions.corruptionReplacements;

        const defaultColor = this.makeAnsiColor({ colorHex: defaultTextColorHex, colorRgba: defaultTextColorRgba });
        this.colorStack.push(defaultColor);
        this.result += defaultColor;
    }

    static convert(nodes: Node[], options?: Partial<AnsiConverterOptions>): string {
        const converter = new AnsiConverter(options);
        converter.visitAll(nodes);
        return converter.getResult();
    }

    static convertFromShellText(input: string, options?: Partial<AnsiConverterOptions>): string {
        const nodes: Node[] = ShellParser.parse(input);
        return this.convert(nodes, options);
    }

    getResult(): string {
        if (this.colorDepth !== ColorDepth.NONE) {
            this.result += '\x1b[0m';
        }

        return this.result;
    }

    visitColor(node: ColorNode): void {
        const prevColor: string = this.colorStack[this.colorStack.length - 1];
        const newColor: string = this.makeAnsiColor(node);
        this.result += newColor;

        this.colorStack.push(newColor);
        this.visitAll(node.children);
        this.colorStack.pop();

        this.result += prevColor;
    }

    visitText(node: TextNode): void {
        const text: string = this.replaceCorruption
            ? this.convertCorruption(node.text)
            : node.text;

        this.result += text;
    }

    private convertCorruption(text: string): string {
        let newText: string = '';

        for (const char of text) {
            if (isCorruptionChar(char)) {
                newText += this.corruptionReplacements[char];
            } else {
                newText += char;
            }
        }

        return newText;
    }

    private makeAnsiColor(node: Pick<ColorNode, 'colorHex' | 'colorRgba'>): string {
        switch (this.colorDepth) {
            case ColorDepth.NONE:
                return '';
            case ColorDepth.EIGHT_BIT:
                return this.makeEightBitColor(node);
            case ColorDepth.TRUE_COLOR:
                return this.makeTrueColor(node);
        }
    }

    private makeEightBitColor(node: Pick<ColorNode, 'colorHex'>): string {
        const vgaColor: string = vgaTranslationTable[node.colorHex.substring(0, 6)];
        if (!vgaColor) throw new Error(`Unknown color: ${node.colorHex}!`);

        return `\x1b[${vgaColor}m`;
    }

    private makeTrueColor(node: Pick<ColorNode, 'colorRgba'>): string {
        const color = node.colorRgba;
        return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m`;
    }
}
