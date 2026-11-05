/** Durable delivery receipts and execution-generation filtering at step admission. */
import type { Context } from '@deepseek-ai/cordis';
import type { TeamMessage, TeamState } from './types.ts';
export declare function isCurrentMail(team: TeamState, message: TeamMessage): boolean;
/** Include structured provenance even in the status-tool fallback presentation. */
export declare function mailboxContent(message: TeamMessage): string;
/** Read current mail while the caller holds the lock and has verified the team. */
export declare function readCurrentMailboxLocked(root: string, team: TeamState, recipient: string, onMalformed?: (line: number) => void): Promise<TeamMessage[]>;
/** Fallback reads must enforce the same current-generation rule as live admission. */
export declare function readCurrentMailbox(root: string, teamId: string, recipient: string, onMalformed?: (line: number) => void): Promise<TeamMessage[]>;
export declare function mailboxPrompt(teamId: string, recipient: string, messages: readonly TeamMessage[]): string;
/** Only messages actually admitted to this recipient's step become read. */
export declare function installMailboxAdmission(ctx: Context, stateDir: string): void;
