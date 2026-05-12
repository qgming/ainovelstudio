import type { z } from "zod";

export type AgentToolPromptSpec = {
  description: string;
  inputSchema: z.ZodTypeAny;
};

type ZodShapeLike = Record<string, z.ZodTypeAny>;

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  const candidate = schema as z.ZodTypeAny & {
    unwrap?: () => z.ZodTypeAny;
    _def?: { innerType?: z.ZodTypeAny };
  };
  if (typeof candidate.unwrap === "function") {
    return unwrapSchema(candidate.unwrap());
  }
  if (candidate._def?.innerType) {
    return unwrapSchema(candidate._def.innerType);
  }
  return schema;
}

function getObjectShape(schema: z.ZodTypeAny): ZodShapeLike | null {
  const unwrapped = unwrapSchema(schema);
  const candidate = unwrapped as unknown as {
    shape?: ZodShapeLike;
    _def?: { shape?: ZodShapeLike | (() => ZodShapeLike) };
  };
  if (candidate.shape && typeof candidate.shape === "object") {
    return candidate.shape;
  }
  const defShape = candidate._def?.shape;
  if (typeof defShape === "function") {
    return defShape();
  }
  if (defShape && typeof defShape === "object") {
    return defShape;
  }
  return null;
}

function getArrayElement(schema: z.ZodTypeAny): z.ZodTypeAny | null {
  const unwrapped = unwrapSchema(schema) as z.ZodTypeAny & {
    element?: z.ZodTypeAny;
    _def?: { element?: z.ZodTypeAny };
  };
  return unwrapped.element ?? unwrapped._def?.element ?? null;
}

function isOptionalField(schema: z.ZodTypeAny) {
  const candidate = schema as z.ZodTypeAny & {
    isOptional?: () => boolean;
  };
  return Boolean(candidate.isOptional?.());
}

export function renderToolParameters(inputSchema: z.ZodTypeAny) {
  const shape = getObjectShape(inputSchema);
  if (!shape) {
    return [];
  }

  return Object.entries(shape).map(([name, schema]) => {
    const description = schema.description?.trim() || "参数说明由工具 schema 提供。";
    const optionalMark = isOptionalField(schema) ? "?" : "";
    const elementShape = getArrayElement(schema);
    const nestedShape = elementShape ? getObjectShape(elementShape) : null;
    const nested =
      nestedShape && Object.keys(nestedShape).length > 0
        ? [
            `  - ${name}${optionalMark}：${description}`,
            ...Object.entries(nestedShape).map(([childName, childSchema]) => {
              const childOptionalMark = isOptionalField(childSchema) ? "?" : "";
              const childDescription =
                childSchema.description?.trim() || "数组元素字段。";
              return `    - ${name}[].${childName}${childOptionalMark}：${childDescription}`;
            }),
          ].join("\n")
        : null;
    return nested ?? `  - ${name}${optionalMark}：${description}`;
  });
}
