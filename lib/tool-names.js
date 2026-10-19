/** Stable business API names; exposure changes never rename these operations. */
export const TEAM_TOOL_NAMES = [
    'agent_teams_create', 'agent_teams_approve', 'agent_teams_edit_plan',
    'agent_teams_add_member', 'agent_teams_remove_member', 'agent_teams_create_task',
    'agent_teams_reassign_task', 'agent_teams_claim_task', 'agent_teams_update_task',
    'agent_teams_amend_task',
    'agent_teams_send_message', 'agent_teams_status', 'agent_teams_resume', 'agent_teams_delete',
    'agent_teams_adopt', 'agent_teams_set_member_model', 'agent_teams_team_memory',
];
export const MEMBER_TOOL_NAMES = [
    'agent_teams_claim_task', 'agent_teams_update_task', 'agent_teams_send_message', 'agent_teams_status',
    'agent_teams_team_memory',
];
export const CAPTAIN_TOOL_NAMES = TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name));
/**
 * Captain-only tools a PM (project-manager member) may also invoke. The PM is
 * an independent member — not the captain — that acts as the captain's
 * scheduling proxy inside the team. These tools let the PM create, reassign,
 * amend tasks and hot-swap member models without round-tripping through the
 * captain. Membership is opt-in per team: a member named `pm` (exact match on
 * the sanitized key) receives these tools; all other members keep the default
 * member filter.
 */
export const PM_EXTRA_TOOL_NAMES = [
    'agent_teams_create_task',
    'agent_teams_reassign_task',
    'agent_teams_amend_task',
    'agent_teams_set_member_model',
];
/** Whether a member name is the PM scheduling proxy. */
export function isPmMemberName(memberName) {
    if (memberName === undefined)
        return false;
    return memberName.trim().toLowerCase() === 'pm';
}
