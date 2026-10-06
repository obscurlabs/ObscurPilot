export const GROQ_ADAPTER_PACKAGE = '@obscurpilot/adapters/groq' as const;

export { createGroqClient, type GroqClientOptions } from './client.js';
export { GroqAdapterError, translateGroqError, type GroqFaultCode } from './errors.js';
export {
  GroqReasoningAdapter,
  createSdkReasoningTransport,
  type GroqReasoningAdapterOptions,
  type ModelToolCall,
  type ReasoningMessage,
  type ReasoningToolSpec,
  type ReasoningTransport,
  type ReasoningTurn,
} from './reasoning.js';
export {
  GuardedReasoningOrchestrator,
  REASONING_PROMPT_VERSION,
  TOOL_POLICY_VERSION,
  type ConfirmationRequest,
  type GuardedReasoningOrchestratorOptions,
  type ReasoningExecutionSnapshot,
  type ReasoningRunResult,
  type ToolAuditEvent,
} from './tool-orchestrator.js';
