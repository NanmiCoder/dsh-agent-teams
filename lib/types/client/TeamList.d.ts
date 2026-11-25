/** Workspace filter and grouped team summaries for the global console. */
import type { ConsoleTeamRow } from './team-console-state.ts';
import type { AgentTeamsTranslate } from './locales.ts';
/** Display a workspace title without conflating an empty title with "all". */
export declare function consoleWorkspaceLabel(workspace: string, t: AgentTeamsTranslate): string;
/** Group rows by workspace while retaining the host's live-then-archive order. */
export declare function groupConsoleRows(rows: readonly ConsoleTeamRow[]): readonly {
    readonly workspace: string;
    readonly rows: readonly ConsoleTeamRow[];
}[];
export declare function WorkspaceFilter({ workspaces, counts, total, value, onChange, t }: {
    readonly workspaces: readonly string[];
    readonly counts: ReadonlyMap<string, number>;
    readonly total: number;
    readonly value: string | null;
    readonly onChange: (workspace: string | null) => void;
    readonly t: AgentTeamsTranslate;
}): import("react").JSX.Element | null;
export declare function TeamList({ rows, selectedKey, onSelect, t }: {
    readonly rows: readonly ConsoleTeamRow[];
    readonly selectedKey: string | null;
    readonly onSelect: (key: string) => void;
    readonly t: AgentTeamsTranslate;
}): import("react").JSX.Element;
