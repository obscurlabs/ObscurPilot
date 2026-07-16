import type { ToolRisk } from './policy.js';

export interface ToolExecutionContext {
  readonly correlationId: string;
  readonly signal: AbortSignal;
  readonly commandId?: string;
  readonly confirmed?: boolean;
  readonly expectedObsSnapshotVersion?: number;
  readonly expectedObsGeneration?: number;
}

export interface ToolDefinition<Input, Output> {
  readonly name: string;
  readonly version: number;
  readonly risk: ToolRisk;
  readonly modelName: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  parse(input: unknown): Input;
  authorize(context: ToolExecutionContext, input: Input): Promise<void>;
  execute(context: ToolExecutionContext, input: Input): Promise<Output>;
}

interface RegisteredTool {
  readonly name: string;
  readonly version: number;
  readonly risk: ToolRisk;
  readonly modelName: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  parse(input: unknown): unknown;
  authorize(context: ToolExecutionContext, input: unknown): Promise<void>;
  execute(context: ToolExecutionContext, input: unknown): Promise<unknown>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly modelNames = new Map<string, RegisteredTool>();

  public register<Input, Output>(definition: ToolDefinition<Input, Output>): void {
    if (
      !/^[a-z][a-z0-9_.-]{2,63}$/u.test(definition.name) ||
      !/^[a-z][a-z0-9_-]{2,63}$/u.test(definition.modelName) ||
      definition.version < 1 ||
      definition.description.trim().length < 8 ||
      definition.description.length > 512
    ) {
      throw new Error('Tool name or version is invalid');
    }
    const key = this.key(definition.name, definition.version);
    if (this.tools.has(key)) throw new Error('Duplicate tool definition: ' + key);
    if (this.modelNames.has(definition.modelName)) {
      throw new Error('Duplicate model tool name: ' + definition.modelName);
    }
    const registered: RegisteredTool = {
      name: definition.name,
      version: definition.version,
      risk: definition.risk,
      modelName: definition.modelName,
      description: definition.description,
      parameters: Object.freeze({ ...definition.parameters }),
      parse: (input) => definition.parse(input),
      authorize: (context, input) => definition.authorize(context, input as Input),
      execute: (context, input) => definition.execute(context, input as Input),
    };
    this.tools.set(key, registered);
    this.modelNames.set(definition.modelName, registered);
  }

  public descriptor(
    name: string,
    version: number,
  ): Readonly<Pick<RegisteredTool, 'name' | 'version' | 'risk'>> {
    const tool = this.resolve(name, version);
    return Object.freeze({ name: tool.name, version: tool.version, risk: tool.risk });
  }

  public modelDescriptors(): ReadonlyArray<
    Readonly<
      Pick<RegisteredTool, 'name' | 'version' | 'risk' | 'modelName' | 'description' | 'parameters'>
    >
  > {
    return [...this.tools.values()].map((tool) =>
      Object.freeze({
        name: tool.name,
        version: tool.version,
        risk: tool.risk,
        modelName: tool.modelName,
        description: tool.description,
        parameters: tool.parameters,
      }),
    );
  }

  public descriptorForModelName(
    modelName: string,
  ): Readonly<Pick<RegisteredTool, 'name' | 'version' | 'risk' | 'modelName'>> {
    const tool = this.modelNames.get(modelName);
    if (tool === undefined) throw new Error('Unknown model tool: ' + modelName);
    return Object.freeze({
      name: tool.name,
      version: tool.version,
      risk: tool.risk,
      modelName: tool.modelName,
    });
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
