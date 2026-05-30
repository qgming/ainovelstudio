import type { TSchema } from "@earendil-works/pi-ai";

// TypeBox schema 是 JSON-Schema 风格的普通对象。这里按需读取它的 properties/required/items/description，
// 复刻旧 zod 版 renderToolParameters 的输出（参数行 + 数组元素嵌套字段 + 可选 ? 标记）。

type JsonSchemaLike = {
  type?: string;
  description?: string;
  default?: unknown;
  properties?: Record<string, JsonSchemaLike>;
  required?: string[];
  items?: JsonSchemaLike;
  anyOf?: JsonSchemaLike[];
  // TypeBox Optional 包装在 anyOf/[Optional] 符号上；这里统一用 required 判断。
};

function asJsonSchema(schema: TSchema): JsonSchemaLike {
  return schema as unknown as JsonSchemaLike;
}

// 解出对象 schema 的字段表与必填集合；非对象返回 null。
function getObjectShape(schema: JsonSchemaLike): { properties: Record<string, JsonSchemaLike>; required: Set<string> } | null {
  if (schema.properties && typeof schema.properties === "object") {
    return { properties: schema.properties, required: new Set(schema.required ?? []) };
  }
  return null;
}

// 取数组元素 schema。
function getArrayElement(schema: JsonSchemaLike): JsonSchemaLike | null {
  return schema.items ?? null;
}

function describe(schema: JsonSchemaLike, fallback: string) {
  return schema.description?.trim() || fallback;
}

export function renderToolParameters(parameters: TSchema): string[] {
  const root = getObjectShape(asJsonSchema(parameters));
  if (!root) return [];

  // 字段是否应渲染 ? 标记：不在 required 里，或带 default（与旧 zod isOptional() 一致——
  // zod 中 .default(x) 会让字段在输入上变为可选，故旧 prompt 对 default 字段也渲染 ?）。
  const isOptionalField = (name: string, schema: JsonSchemaLike, required: Set<string>) =>
    !required.has(name) || schema.default !== undefined;

  return Object.entries(root.properties).map(([name, schema]) => {
    const description = describe(schema, "参数说明由工具 schema 提供。");
    const optionalMark = isOptionalField(name, schema, root.required) ? "?" : "";
    const elementSchema = getArrayElement(schema);
    const nestedShape = elementSchema ? getObjectShape(elementSchema) : null;

    if (nestedShape && Object.keys(nestedShape.properties).length > 0) {
      return [
        `  - ${name}${optionalMark}：${description}`,
        ...Object.entries(nestedShape.properties).map(([childName, childSchema]) => {
          const childOptionalMark = isOptionalField(childName, childSchema, nestedShape.required) ? "?" : "";
          const childDescription = describe(childSchema, "数组元素字段。");
          return `    - ${name}[].${childName}${childOptionalMark}：${childDescription}`;
        }),
      ].join("\n");
    }

    return `  - ${name}${optionalMark}：${description}`;
  });
}
