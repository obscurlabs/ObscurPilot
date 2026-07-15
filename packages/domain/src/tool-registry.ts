import type { ToolRisk } from './policy.js';

export interface ToolExecutionContext {
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export interface ToolDefinition<Input, Output> {
  readonly name: string;
  readonly version: number;
  readonly risk: ToolRisk;
  parse(input: unknown): Input;
  authorize(context: ToolExecutionContext, input: Input): Promise<void>;
  execute(context: ToolExecutionContext, input: Input): Promise<Output>;
}

interface RegisteredTool {
  readonly name: string;
  readonly version: number;
  readonly risk: ToolRisk;
  parse(input: unknown): unknown;
  authorize(context: ToolExecutionContext, input: unknown): Promise<void>;
  execute(context: ToolExecutionContext, input: unknown): Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  public register<Input, Output>(definition: ToolDefinition<Input, Output>): void {
    if (!/^[a-z][a-z0-9_.-]{2,63}$/.test(definition.name) || definition.version < 1) {
      throw new Error('Tool name or version is invalid');
    }
    const key = this.key(definition.name, definition.version);
    if (this.tools.has(key)) throw new Error('Duplicate tool definition: ' + key);
    this.tools.set(key, {
      name: definition.name,
      version: definition.version,
      risk: definition.risk,
      parse: (input) => definition.parse(input),
      authorize: (context, input) => definition.authorize(context, input as Input),
      execute: (context, input) => definition.execute(context, input as Input),
    });
  }

  public descriptor(
    name: string,
    version: number,
  ): Readonly<Pick<RegisteredTool, 'name' | 'version' | 'risk'>> {
    const tool = this.resolve(name, version);
    return Object.freeze({ name: tool.name, version: tool.version, risk: tool.risk });
  }

  public async invoke(
    name: string,
    version: number,
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    const tool = this.resolve(name, version);
    const parsed = tool.parse(input);
    await tool.authorize(context, parsed);
    return tool.execute(context, parsed);
  }

  private resolve(name: string, version: number): RegisteredTool {
    const tool = this.tools.get(this.key(name, version));
    if (tool === undefined) throw new Error('Unknown tool: ' + name + '@' + version);
    return tool;
  }

  private key(name: string, version: number): string {
    return name + '@' + version;
  }
}
