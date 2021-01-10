import * as fs from "fs";

import {
  quicktype,
  InputData,
  JSONSchemaInput,
  CSharpTargetLanguage,
  FetchingJSONSchemaStore,
  RenderContext,
  CSharpRenderer,
  ClassType,
  cSharpOptions,
  Sourcelike,
  Type,
  getOptionValues,
  TypeAttributeKind,
  JSONSchema,
  JSONSchemaAttributes,
  ClassProperty,
  Name,
  PrimitiveType,
  EnumType,
  panic,
  TargetLanguage,
  UnionType,
  ArrayType,
  NewtonsoftCSharpTargetLanguage,
  NewtonsoftCSharpRenderer,
  newtonsoftCSharpOptions,
} from "quicktype-core";

import { mapFromObject, mapFilterMap } from "collection-utils";
import { followTargetType } from "quicktype-core/dist/Transformers";
import { utf16StringEscape } from "quicktype-core/dist/support/Strings";
import { OptionValues } from "quicktype-core/dist/RendererOptions";
import { SourcelikeArray } from "quicktype-core/dist/Source";

class DefaultValueTypeAttributeKind extends TypeAttributeKind<
  Map<string, ReadonlySet<string>>
> {
  constructor() {
    super("propertyDefaults");
  }

  combine(
    attrs: Map<string, ReadonlySet<string>>[]
  ): Map<string, ReadonlySet<string>> {
    const a = attrs[0];
    return a;
  }

  makeInferred(_: any): undefined {
    return undefined;
  }

  stringify(v: any): string {
    return JSON.stringify(v.toObject());
  }
}

const defaultValueTypeAttributeKind = new DefaultValueTypeAttributeKind();

async function main(program: string, args: string[]): Promise<void> {
  const inputData = new InputData();
  const source = {
    kind: "schema",
    name: "Models",
    uris: [args[0]],
  };
  await inputData.addSource(
    "schema",
    source,
    () =>
      new JSONSchemaInput(
        new FetchingJSONSchemaStore(undefined),
        [propertyDefaultsAttributeProducer],
        []
      )
  );

  const lang = new CustomCSharpLanguage();
  const { lines } = await quicktype({ lang, inputData, combineClasses: false });
  fs.writeFileSync(args[1], lines.join("\n"));
}

class CustomCSharpLanguage extends NewtonsoftCSharpTargetLanguage {
  protected makeRenderer(
    renderContext: RenderContext,
    untypedOptionValues: { [name: string]: any }
  ): NewtonsoftCSharpRenderer {
    return new CustomCSharpRenderer(
      this,
      renderContext,
      getOptionValues(newtonsoftCSharpOptions, untypedOptionValues)
    );
  }
}

class CustomCSharpRenderer extends NewtonsoftCSharpRenderer {
  options: OptionValues<typeof newtonsoftCSharpOptions>;
  constructor(
    targetLanguage: TargetLanguage,
    renderContext: RenderContext,
    private readonly csOptions: OptionValues<typeof newtonsoftCSharpOptions>
  ) {
    super(targetLanguage, renderContext, csOptions);
    this.options = csOptions;
    this.options.useList = true;
  }

  protected superclassForType(t: Type): Sourcelike | undefined {
    if (t instanceof ClassType) {
      return "GameObject";
    }
    return undefined;
  }

  private stringCaseValue2(t: Type, stringCase: string): Sourcelike {
    if (t.kind === "string") {
      return ['"', utf16StringEscape(stringCase), '"'];
    } else if (t instanceof EnumType) {
      try {
        return [
          this.nameForNamedType(t),
          ".",
          this.nameForEnumCase(t, stringCase),
        ];
      } catch (e) {
        console.log(e);
      }
    }
    return panic(`Type ${t.kind} does not have string cases`);
  }

  protected propertyDefinition(
    p: ClassProperty,
    name: Name,
    c: ClassType,
    jsonName: string
  ): Sourcelike {
    // Call "CSharpRenderer"'s "propertyDefinition" to get the code for the property
    // definition without the default value assignment.
    const originalDefinition = super.propertyDefinition(p, name, c, jsonName);
    const defaultValue: Map<string, any> = this.typeGraph.attributeStore.tryGet(
      defaultValueTypeAttributeKind,
      c
    );

    if (defaultValue === undefined || !defaultValue.has(jsonName))
      return originalDefinition;

    const value = defaultValue.get(jsonName);
    let defaultText = "";
    const stringified = JSON.stringify(value);
    const targetType = followTargetType(p.type);
    if (Array.isArray(value)) {
      const defaultArray = value as Array<any>;
      if (defaultArray.length === 1) {
        defaultText = stringified.slice(1, stringified.length - 1);
      } else {
        let text = JSON.stringify(defaultArray, (k, v) => {
          if (Number.isInteger(v)) {
            return v + 1e-10;
          }
          return v;
        })
          .replace(/\.0000000001/g, ".0")
          .replace(/1e-10/g, "0.0");
        if (!this.options.useList) {
          defaultText = "new[] {" + text.slice(1).replace(/.$/, "}");
        } else {
          defaultText =
            "new List<" +
            getArrayType(targetType) +
            "> {" +
            text.slice(1).replace(/.$/, "}");
        }
      }
    } else if (targetType instanceof EnumType) {
      const enumName = this.stringCaseValue2(targetType as EnumType, value);
      return [originalDefinition, " = ", enumName, ";"];
    } else if (typeof value === "boolean") {
      return [
        originalDefinition,
        " = new ",
        (originalDefinition as SourcelikeArray)[1],
        "();",
      ];
    } else {
      defaultText = stringified;
    }
    return [originalDefinition, " = ", defaultText, ";"];
  }
}

function getArrayType(propertyType: Type): String {
  let result = "";
  if (propertyType instanceof PrimitiveType) return propertyType.kind;
  if (propertyType instanceof ArrayType) return propertyType.items.kind;
  if (propertyType instanceof UnionType) {
    const unionType = propertyType as UnionType;
    unionType.members.forEach((member) => {
      if (member instanceof ArrayType) {
        const arrayType = member as ArrayType;
        result = arrayType.items.kind;
        return;
      }
    });
  }
  return result;
}

function propertyDefaultsAttributeProducer(
  schema: JSONSchema
): JSONSchemaAttributes | undefined {
  // booleans are valid JSON Schemas, too, but we won't produce our
  // attribute for them.
  if (typeof schema !== "object") return undefined;
  if (schema.properties === undefined) return undefined;
  const propertyDescriptions = mapFilterMap(
    mapFromObject<any>(schema.properties),
    (propSchema) => {
      if (typeof propSchema === "object") {
        const desc = propSchema.default;
        return desc;
      }
      return undefined;
    }
  );

  const attributes = defaultValueTypeAttributeKind.makeAttributes(
    propertyDescriptions
  );
  return {
    forObject: attributes,
  };
}

main(process.argv[1], process.argv.slice(2));
