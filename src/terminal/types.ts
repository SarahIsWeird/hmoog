export enum NodeType {
    TEXT,
    COLOR,
    END_TAG,
}

export type TextNode = {
    type: NodeType.TEXT,
    text: string,
};

export type Rgba = [ number, number, number, number ];

export type ColorNode = {
    type: NodeType.COLOR,
    colorHex: string,
    colorRgba: Rgba,
    children: Node[],
};

export type EndTag = {
    type: NodeType.END_TAG,
    name: string,
};

export type Node = TextNode | ColorNode;
export type ParseNode = Node | EndTag;

export abstract class NodeVisitor {
    visitAll(nodes: Node[]): void {
        for (const node of nodes) {
            this.visit(node);
        }
    }

    visit(node: Node): void {
        switch (node.type) {
            case NodeType.TEXT:
                this.visitText(node);
                break;
            case NodeType.COLOR:
                this.visitColor(node);
                break;
        }
    }

    abstract visitText(node: TextNode): void;
    abstract visitColor(node: ColorNode): void;
}
