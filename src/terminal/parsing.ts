import { Node, NodeType, ParseNode, Rgba } from './types.js';

const hexToRgba = (color: string): Rgba => {
    const r = parseInt(color.substring(0, 2), 16);
    const g = parseInt(color.substring(2, 4), 16);
    const b = parseInt(color.substring(4, 6), 16);
    const a = parseInt(color.substring(6, 8), 16);

    return [ r, g, b, a ];
};

const charReplacements = {
    // Colorable backtick
    '\xab': '`',

    // Angled brackets
    '\xc8': '<',
    '\xc9': '>',
};

export const isReplaceable = (c: string): c is (keyof typeof charReplacements) =>
    Object.keys(charReplacements).includes(c);

export class ShellParser {
    private str: string;

    constructor(input: string) {
        this.str = input;
    }

    static parse(input: string): Node[] {
        return new ShellParser(input).parseAll();
    }

    parseAll(): Node[] {
        let nodes: Node[] = [];

        while (this.str.length > 0) {
            const newNode = this.parseTag();
            if (newNode.type === NodeType.END_TAG) throw new Error(`Dangling end tag! ${newNode.name}`);

            nodes.push(newNode);
        }

        return nodes;
    }

    private parseTag(): ParseNode {
        if (!this.str.startsWith('<')) return this.parseText();
        if (this.str.startsWith('</')) return this.parseEndTag();

        if (!this.str.startsWith('<color=#')) {
            const firstEquals = this.str.indexOf('>');
            throw new Error(`Unknown tag: ${this.str.substring(1, firstEquals)}`);
        }

        let lengthOfTagStart = '<color=#'.length;
        const colorHex = this.str.substring(lengthOfTagStart, lengthOfTagStart + 8);
        const colorRgba = hexToRgba(colorHex);

        this.str = this.str.substring(lengthOfTagStart + 9);

        let children: Node[] = [];
        let foundEnd = false;
        while (this.str.length > 0) {
            const newNode = this.parseTag();

            if (newNode.type !== NodeType.END_TAG) {
                children.push(newNode);
                continue;
            }

            if (newNode.name !== 'color') throw new Error(`Dangling end tag! ${newNode.name}`);

            foundEnd = true;
            break;
        }

        if (!foundEnd) throw new Error('Expected </color>, but got EOF!');

        return {
            type: NodeType.COLOR,
            colorHex: colorHex,
            colorRgba: colorRgba,
            children: children,
        };
    }

    private parseEndTag(): ParseNode {
        const endIndex = this.str.indexOf('>');
        if (endIndex === -1) throw new Error(`Tag was never closed: ${this.str}`);

        const tagName = this.str.substring(2, endIndex);
        this.str = this.str.substring(endIndex + 1);
        return { type: NodeType.END_TAG, name: tagName };
    }

    private parseText(): ParseNode {
        let text = '';

        let i = 0;
        for (; i < this.str.length; i++) {
            const char = this.str[i];
            if (char === '<') break;

            if (isReplaceable(char)) {
                text += charReplacements[char];
            } else {
                text += char;
            }
        }

        this.str = this.str.substring(i);
        return { type: NodeType.TEXT, text };
    }
}
