import {
  ChatAnalysisProjectionSchema,
  ChatMessageProjectionSchema,
  ModerationIntentV1Schema,
  type ChatAnalysisProjection,
  type ChatMessageProjection,
  type ModerationIntentV1,
} from '@obscurpilot/contracts/live-session';

const LINK_PATTERN = /https?:\/\/\S+/giu;
const MENTION_PATTERN = /@[a-z0-9_]{2,25}/giu;
const REPEATED_PATTERN = /(.)\1{8,}/u;

export interface ChatIngestInput {
  readonly messageId: string;
  readonly broadcasterId: string;
  readonly userId: string;
  readonly userLogin: string;
  readonly userDisplayName: string;
  readonly text: string;
  readonly occurredAt: string;
  readonly roles: ChatMessageProjection['roles'];
}

export class BoundedChatIntelligence {
  private readonly messages = new Map<string, ChatMessageProjection>();
  private readonly arrivals = new Map<string, number[]>();

  public constructor(
    private readonly maxMessages = 500,
    private readonly maxPerUserPerTenSeconds = 8,
    private readonly now: () => number = Date.now,
  ) {}

  public ingest(input: ChatIngestInput): {
    readonly accepted: boolean;
    readonly message?: ChatMessageProjection;
    readonly analysis?: ChatAnalysisProjection;
  } {
    if (this.messages.has(input.messageId)) return { accepted: false };
    const text = [...input.text.normalize('NFKC')]
      .filter((value) => {
        const code = value.codePointAt(0) ?? 0;
        return code > 31 && code !== 127;
      })
      .join('')
      .slice(0, 500);
    const message = ChatMessageProjectionSchema.parse({
      ...input,
      text,
      links: text.match(LINK_PATTERN)?.length ?? 0,
      mentions: text.match(MENTION_PATTERN)?.length ?? 0,
    });
    this.messages.set(message.messageId, message);
    while (this.messages.size > this.maxMessages) {
      const oldest = this.messages.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.messages.delete(oldest);
    }
    const burst = this.recordArrival(message.userId);
    return { accepted: true, message, analysis: analyze(message, burst, this.now()) };
  }

  public get(messageId: string): ChatMessageProjection | undefined {
    return this.messages.get(messageId);
  }

  public snapshot(): readonly ChatMessageProjection[] {
    return [...this.messages.values()];
  }

  private recordArrival(userId: string): boolean {
    const cutoff = this.now() - 10_000;
    const values = (this.arrivals.get(userId) ?? []).filter((value) => value >= cutoff);
    values.push(this.now());
    this.arrivals.set(userId, values);
    if (this.arrivals.size > 2_000) {
      for (const [id, timestamps] of this.arrivals) {
        if (timestamps.every((value) => value < cutoff)) this.arrivals.delete(id);
      }
    }
    return values.length > this.maxPerUserPerTenSeconds;
  }
}

export class ModerationGuard {
  private readonly completed = new Set<string>();

  public constructor(private readonly protectedUserIds: ReadonlySet<string>) {}

  public authorize(
    intentInput: ModerationIntentV1,
    evidence: ChatMessageProjection | undefined,
    broadcasterId: string,
    confirmed: boolean,
  ): ModerationIntentV1 {
    const intent = ModerationIntentV1Schema.parse(intentInput);
    if (this.completed.has(intent.intentId)) return intent;
    if (intent.targetUserId === broadcasterId || this.protectedUserIds.has(intent.targetUserId)) {
      throw new Error('PROTECTED_ACCOUNT');
    }
    if (!confirmed) throw new Error('CONFIRMATION_REQUIRED');
    if (intent.evidenceMessageId !== undefined) {
      if (
        evidence?.messageId !== intent.evidenceMessageId ||
        evidence.userId !== intent.targetUserId
      ) {
        throw new Error('EVIDENCE_TARGET_MISMATCH');
      }
    }
    if (intent.action === 'delete_message' && intent.messageId === undefined) {
      throw new Error('MESSAGE_ID_REQUIRED');
    }
    if (intent.action === 'timeout_user' && intent.durationSeconds === undefined) {
      throw new Error('TIMEOUT_DURATION_REQUIRED');
    }
    return intent;
  }

  public complete(intentId: string): void {
    this.completed.add(intentId);
    if (this.completed.size > 10_000)
      this.completed.delete(this.completed.values().next().value as string);
  }

  public isComplete(intentId: string): boolean {
    return this.completed.has(intentId);
  }
}

function analyze(
  message: ChatMessageProjection,
  burst: boolean,
  now: number,
): ChatAnalysisProjection {
  const reasonCodes: string[] = [];
  if (burst) reasonCodes.push('USER_BURST');
  if (message.links >= 3) reasonCodes.push('LINK_FLOOD');
  if (message.mentions >= 6) reasonCodes.push('MENTION_FLOOD');
  if (REPEATED_PATTERN.test(message.text)) reasonCodes.push('REPEATED_CHARACTERS');
  const letters = [...message.text].filter((value) => /[a-z]/iu.test(value));
  if (
    letters.length >= 20 &&
    letters.filter((value) => value === value.toUpperCase()).length / letters.length > 0.85
  ) {
    reasonCodes.push('EXCESSIVE_CAPS');
  }
  const score = Math.min(1, reasonCodes.length * 0.24 + (burst ? 0.2 : 0));
  const severity = score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : score > 0 ? 'low' : 'none';
  const suggestedAction =
    severity === 'high' ? 'timeout' : severity === 'medium' ? 'delete' : 'none';
  return ChatAnalysisProjectionSchema.parse({
    messageId: message.messageId,
    reasonCodes,
    confidence: score,
    severity,
    suggestedAction,
    analyzedAt: new Date(now).toISOString(),
  });
}
