import { AbstractFormatter, AstNode, Formatting, LangiumDocument } from 'langium';

import * as ast from '@zenstackhq/language/ast';
import { FormattingOptions, Range, TextEdit } from 'vscode-languageserver';

export class ZModelFormatter extends AbstractFormatter {
    private formatOptions?: FormattingOptions;
    protected format(node: AstNode): void {
        const formatter = this.getNodeFormatter(node);
        if (ast.isDataModelField(node)) {
            formatter.property('type').prepend(Formatting.oneSpace());
            if (node.attributes.length > 0) {
                formatter.properties('attributes').prepend(Formatting.oneSpace());
            }
        } else if (ast.isDataModelFieldAttribute(node)) {
            formatter.keyword('(').surround(Formatting.noSpace());
            formatter.keyword(')').prepend(Formatting.noSpace());
            formatter.keyword(',').append(Formatting.oneSpace());
            if (node.args.length > 1) {
                formatter.nodes(...node.args.slice(1)).prepend(Formatting.oneSpace());
            }
        } else if (ast.isAttributeArg(node)) {
            formatter.keyword(':').prepend(Formatting.noSpace());
            formatter.keyword(':').append(Formatting.oneSpace());
        } else if (ast.isAbstractDeclaration(node)) {
            const bracesOpen = formatter.keyword('{');
            const bracesClose = formatter.keyword('}');
            // this line decide the indent count return by this.getIndent()
            formatter.interior(bracesOpen, bracesClose).prepend(Formatting.indent());
            bracesOpen.prepend(Formatting.oneSpace());
            bracesClose.prepend(Formatting.newLine());
        } else if (ast.isModel(node)) {
            const model = node as ast.Model;
            const nodes = formatter.nodes(...model.declarations);
            nodes.prepend(Formatting.noIndent());
        }
    }

    protected override doDocumentFormat(
        document: LangiumDocument<AstNode>,
        options: FormattingOptions,
        range?: Range | undefined
    ): TextEdit[] {
        this.formatOptions = options;
        return super.doDocumentFormat(document, options, range);
    }

    public getFormatOptions(): FormattingOptions | undefined {
        return this.formatOptions;
    }

    public getIndent() {
        return 1;
    }
}
