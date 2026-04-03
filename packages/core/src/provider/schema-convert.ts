import type { z } from "zod"

/**
 * Convert a Zod schema to JSON Schema for the OpenAI API.
 * Handles the common Zod types used in tool definitions.
 */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return convertZodType(schema)
}

function convertZodType(schema: z.ZodType): Record<string, unknown> {
  const def = (schema as any)._def

  if (!def) {
    return { type: "object" }
  }

  switch (def.typeName) {
    case "ZodString":
      return handleString(def)
    case "ZodNumber":
      return handleNumber(def)
    case "ZodBoolean":
      return { type: "boolean" }
    case "ZodArray":
      return {
        type: "array",
        items: convertZodType(def.type),
      }
    case "ZodObject":
      return handleObject(def)
    case "ZodEnum":
      return {
        type: "string",
        enum: def.values,
      }
    case "ZodOptional":
      return convertZodType(def.innerType)
    case "ZodDefault":
      return {
        ...convertZodType(def.innerType),
        default: def.defaultValue(),
      }
    case "ZodLiteral":
      return {
        type: typeof def.value,
        const: def.value,
      }
    case "ZodUnion":
      return {
        oneOf: def.options.map((o: z.ZodType) => convertZodType(o)),
      }
    case "ZodRecord":
      return {
        type: "object",
        additionalProperties: convertZodType(def.valueType),
      }
    case "ZodNullable":
      return {
        ...convertZodType(def.innerType),
        nullable: true,
      }
    case "ZodEffects":
      return convertZodType(def.schema)
    case "ZodDescription":
      return {
        ...convertZodType(def.innerType),
        description: def.description,
      }
    default:
      return { type: "object" }
  }
}

function handleString(def: any): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "string" }
  if (def.description) result.description = def.description
  if (def.checks) {
    for (const check of def.checks) {
      if (check.kind === "min") result.minLength = check.value
      if (check.kind === "max") result.maxLength = check.value
    }
  }
  return result
}

function handleNumber(def: any): Record<string, unknown> {
  const result: Record<string, unknown> = { type: "number" }
  if (def.description) result.description = def.description
  if (def.checks) {
    for (const check of def.checks) {
      if (check.kind === "int") result.type = "integer"
      if (check.kind === "min") result.minimum = check.value
      if (check.kind === "max") result.maximum = check.value
    }
  }
  return result
}

function handleObject(def: any): Record<string, unknown> {
  const shape = def.shape?.()
  if (!shape) return { type: "object" }

  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    properties[key] = convertZodType(value as z.ZodType)

    // Check if field is required (not optional/default)
    const fieldDef = (value as any)._def
    if (fieldDef?.typeName !== "ZodOptional" && fieldDef?.typeName !== "ZodDefault") {
      required.push(key)
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
  }
  if (required.length > 0) result.required = required
  return result
}
