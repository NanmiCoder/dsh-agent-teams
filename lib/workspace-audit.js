/**
 * The single workspace audit shared by every surface that reports a delivery
 * or quality-loop conclusion.
 *
 * `agent_teams_status`, the activity-panel route and any Web API consumer must
 * read the same current bytes: if only one of them compared recorded verdicts
 * against the workspace, the other would keep advertising a passing gate over
 * a revision no review ever saw (issue #161).
 *
 * The audit consumes the artifact reader's *complete* result — digests, the
 * enumeration gaps and unreadable paths — because a partial read must never
 * look like a clean one: a scope that outgrew its cap after the review would
 * otherwise be reported as fully verified.
 * @module dsh-agent-teams/workspace-audit
 */
import { readArtifactScopes } from "./artifacts.js";
import { deliveryArtifactPaths, deliveryScopePatterns } from "./quality-gates.js";
/**
 * Read the current workspace bytes a team's recorded verdicts and generated
 * work orders depend on.
 * @param workspace - absolute path of the owning workspace.
 * @param team - the durable team record.
 * @returns digests of every recorded path, the current contents of the scopes
 * the verdicts bound (so a new file cannot slip into a broad scope), and every
 * gap that makes this audit incomplete.
 */
export function auditTeamWorkspace(workspace, team) {
    const paths = deliveryArtifactPaths(team);
    const scopePatterns = deliveryScopePatterns(team);
    const [pathRead, scopeRead] = readArtifactScopes(workspace, [paths, scopePatterns]);
    const gaps = [];
    const seen = new Set();
    const recordGap = (pattern, reason) => {
        const key = `${pattern}\u0000${reason}`;
        if (seen.has(key))
            return;
        seen.add(key);
        gaps.push({ pattern, reason });
    };
    for (const gap of [...pathRead.gaps, ...scopeRead.gaps])
        recordGap(gap.pattern, gap.reason);
    for (const artifact of [...pathRead.artifacts, ...scopeRead.artifacts]) {
        // An unreadable path is not a gap in enumeration but a gap in evidence:
        // report it the same way so no surface treats it as a clean read.
        if (artifact.unreadable === true)
            recordGap(artifact.path, artifact.reason ?? 'path could not be read');
    }
    return {
        artifacts: pathRead.artifacts,
        expandedScope: scopeRead.artifacts.map((artifact) => ({ path: artifact.path, present: artifact.present })),
        ...gaps.length === 0 ? {} : { gaps },
    };
}
