import {
    ArrayExpr,
    DataModel,
    DataModelField,
    isDataModel,
    isLiteralExpr,
    Model,
    ReferenceExpr,
} from '@zenstackhq/language/ast';
import { RuntimeAttribute } from '@zenstackhq/runtime';
import { getAttributeArgs, getDataModels, getLiteral, hasAttribute, PluginOptions, resolved } from '@zenstackhq/sdk';
import { camelCase } from 'change-case';
import path from 'path';
import { CodeBlockWriter, Project, VariableDeclarationKind } from 'ts-morph';
import { getIdFields } from '../../language-server/utils';
import { ensureNodeModuleFolder, getDefaultOutputFolder } from '../plugin-utils';

export const name = 'Model Metadata';

export default async function run(model: Model, options: PluginOptions) {
    const output = options.output ? (options.output as string) : getDefaultOutputFolder();
    if (!output) {
        console.error(`Unable to determine output path, not running plugin ${name}`);
        return;
    }

    const dataModels = getDataModels(model);

    const project = new Project();

    if (!options.output) {
        ensureNodeModuleFolder(output);
    }

    const sf = project.createSourceFile(path.join(output, 'model-meta.ts'), undefined, { overwrite: true });
    sf.addVariableStatement({
        declarationKind: VariableDeclarationKind.Const,
        declarations: [{ name: 'metadata', initializer: (writer) => generateModelMetadata(dataModels, writer) }],
    });
    sf.addStatements('export default metadata;');

    sf.formatText();

    await project.save();
    await project.emit();
}

function generateModelMetadata(dataModels: DataModel[], writer: CodeBlockWriter) {
    writer.block(() => {
        writer.write('fields:');
        writer.block(() => {
            for (const model of dataModels) {
                writer.write(`${camelCase(model.name)}:`);
                writer.block(() => {
                    for (const f of model.fields) {
                        const backlink = getBackLink(f);
                        writer.write(`${f.name}: {
                    name: "${f.name}",
                    type: "${
                        f.type.reference
                            ? f.type.reference.$refText
                            : // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                              f.type.type!
                    }",
                    isId: ${isIdField(f)},
                    isDataModel: ${isDataModel(f.type.reference?.ref)},
                    isArray: ${f.type.array},
                    isOptional: ${f.type.optional},
                    attributes: ${JSON.stringify(getFieldAttributes(f))},
                    backLink: ${backlink ? "'" + backlink.name + "'" : 'undefined'},
                    isRelationOwner: ${isRelationOwner(f)},
                },`);
                    }
                });
                writer.write(',');
            }
        });
        writer.write(',');

        writer.write('uniqueConstraints:');
        writer.block(() => {
            for (const model of dataModels) {
                writer.write(`${camelCase(model.name)}:`);
                writer.block(() => {
                    for (const constraint of getUniqueConstraints(model)) {
                        writer.write(`${constraint.name}: {
                    name: "${constraint.name}",
                    fields: ${JSON.stringify(constraint.fields)}
                },`);
                    }
                });
                writer.write(',');
            }
        });
        writer.write(',');
    });
}

function getBackLink(field: DataModelField) {
    if (!field.type.reference?.ref || !isDataModel(field.type.reference?.ref)) {
        return undefined;
    }

    const relName = getRelationName(field);

    const sourceModel = field.$container as DataModel;
    const targetModel = field.type.reference.ref as DataModel;

    for (const otherField of targetModel.fields) {
        if (otherField.type.reference?.ref === sourceModel) {
            if (relName) {
                const otherRelName = getRelationName(otherField);
                if (relName === otherRelName) {
                    return otherField;
                }
            } else {
                return otherField;
            }
        }
    }
    return undefined;
}

function getRelationName(field: DataModelField) {
    const relAttr = field.attributes.find((attr) => attr.decl.ref?.name === 'relation');
    const relName = relAttr && relAttr.args?.[0] && getLiteral<string>(relAttr.args?.[0].value);
    return relName;
}

function getFieldAttributes(field: DataModelField): RuntimeAttribute[] {
    return field.attributes
        .map((attr) => {
            const args: Array<{ name?: string; value: unknown }> = [];
            for (const arg of attr.args) {
                if (!isLiteralExpr(arg.value)) {
                    // attributes with non-literal args are skipped
                    return undefined;
                }
                args.push({ name: arg.name, value: arg.value.value });
            }
            return { name: resolved(attr.decl).name, args };
        })
        .filter((d): d is RuntimeAttribute => !!d);
}

function isIdField(field: DataModelField) {
    // field-level @id attribute
    if (field.attributes.some((attr) => attr.decl.ref?.name === '@id')) {
        return true;
    }

    // model-level @@id attribute with a list of fields
    const model = field.$container as DataModel;
    const modelLevelIds = getIdFields(model);
    if (modelLevelIds.includes(field)) {
        return true;
    }
    return false;
}

function getUniqueConstraints(model: DataModel) {
    const constraints: Array<{ name: string; fields: string[] }> = [];
    for (const attr of model.attributes.filter(
        (attr) => attr.decl.ref?.name === '@@unique' || attr.decl.ref?.name === '@@id'
    )) {
        const argsMap = getAttributeArgs(attr);
        if (argsMap.fields) {
            const fieldNames = (argsMap.fields as ArrayExpr).items.map(
                (item) => resolved((item as ReferenceExpr).target).name
            );
            let constraintName = argsMap.name && getLiteral<string>(argsMap.name);
            if (!constraintName) {
                // default constraint name is fields concatenated with underscores
                constraintName = fieldNames.join('_');
            }
            constraints.push({ name: constraintName, fields: fieldNames });
        }
    }
    return constraints;
}

function isRelationOwner(field: DataModelField) {
    return hasAttribute(field, '@relation');
}
