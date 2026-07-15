export type ToolRisk = 'observe' | 'reversible' | 'confirm';

export interface ToolGrant {
  readonly toolName: string;
  readonly scopes: ReadonlySet<string>;
  readonly expiresAt: number;
}

export interface AuthorizationRequest {
  readonly now: number;
  readonly toolName: string;
  readonly requiredScope: string;
  readonly risk: ToolRisk;
  readonly confirmed: boolean;
}

export class PolicyDeniedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'PolicyDeniedError';
  }
}

export function authorizeTool(grants: readonly ToolGrant[], request: AuthorizationRequest): void {
  const grant = grants.find(
    (candidate) =>
      candidate.toolName === request.toolName &&
      candidate.expiresAt > request.now &&
      candidate.scopes.has(request.requiredScope),
  );
  if (grant === undefined) {
    throw new PolicyDeniedError('Required tool grant or scope is absent');
  }
  if (request.risk === 'confirm' && !request.confirmed) {
    throw new PolicyDeniedError('Explicit confirmation is required');
  }
}
