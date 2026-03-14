import { z } from 'zod';

/** A raw shape of Zod types describing the input schema for an MCP tool. */
export type ZodRawShape = Record<string, z.ZodTypeAny>;

/**
 * Engine-agnostic definition of an in-process MCP tool.
 * No SDK dependency — each engine adapter is responsible for converting
 * this into its own native tool format.
 */
export interface GenericMcpToolDefinition {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (args: unknown) => Promise<unknown>;
}
