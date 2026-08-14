window.__ModuleLoader__.load({
	id: "dsh-agent-teams",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react_dom_client = require("react-dom/client");
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/client/activity-model.js
		/** Pure relationship projections used by the AgentTeams activity panel. */
		/** Group tasks by their precomputed dependency depth. */
		function taskStages(tasks) {
			const byDepth = /* @__PURE__ */ new Map();
			for (const task of tasks) {
				const depth = Number.isFinite(task.depth) ? Math.max(0, Math.floor(task.depth)) : 0;
				const stage = byDepth.get(depth) ?? [];
				stage.push(task);
				byDepth.set(depth, stage);
			}
			return [...byDepth.entries()].sort(([left], [right]) => left - right).map(([depth, stageTasks]) => ({
				depth,
				tasks: stageTasks.slice().sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }))
			}));
		}
		/**
		* Return the complete upstream/downstream chain around one task.
		*
		* Traversal uses both dependency directions and remains cycle-safe, so the UI
		* can highlight every handoff related to the focused task even if malformed
		* durable data contains a cycle.
		*/
		function relatedTaskIds(taskId, tasks) {
			const byId = new Map(tasks.map((task) => [task.id, task]));
			if (!byId.has(taskId)) return /* @__PURE__ */ new Set();
			const dependents = /* @__PURE__ */ new Map();
			for (const task of tasks) for (const dependency of task.dependencies) {
				const targets = dependents.get(dependency) ?? [];
				targets.push(task.id);
				dependents.set(dependency, targets);
			}
			const related = /* @__PURE__ */ new Set();
			const upstreamSeen = /* @__PURE__ */ new Set();
			const downstreamSeen = /* @__PURE__ */ new Set();
			const visitUpstream = (id) => {
				if (upstreamSeen.has(id)) return;
				upstreamSeen.add(id);
				related.add(id);
				for (const dependency of byId.get(id)?.dependencies ?? []) visitUpstream(dependency);
			};
			const visitDownstream = (id) => {
				if (downstreamSeen.has(id)) return;
				downstreamSeen.add(id);
				related.add(id);
				for (const dependent of dependents.get(id) ?? []) visitDownstream(dependent);
			};
			visitUpstream(taskId);
			visitDownstream(taskId);
			return related;
		}
		//#endregion
		//#region lib/client/artwork.js
		/**
		* Shared whale artwork lookup for the activity panel and the conversation
		* card: role keywords map to the packaged role images; the captain always
		* uses the lead whale.
		* @module dsh-agent-teams/client/artwork
		*/
		/** Artwork route prefix served by the plugin host half. */
		const ART_BASE = "/plugins/dsh-agent-teams/assets/";
		/** Whale role artwork per role keyword. */
		const ROLE_ART = [
			[/resear|analys|investig|explor|data|study|研究|分析|数据|调查|探索|调研/, "researcher.png"],
			[/engineer|dev\b|server|backend|\bapi\b|runtime|watcher|contract|工程|后端|服务|接口|开发|代码|编程/, "engineer.png"],
			[/\bqa\b|test|verif|quality|测试|质量/, "qa-engineer.png"],
			[/design|\bui\b|\bux\b|front|theme|accessib|设计|前端|主题/, "designer.png"],
			[/secur|audit|risk|threat|review|安全|审计|审查|风险/, "security-reviewer.png"],
			[/docs|writer|product|spec|coordin|撰写|文案|写作|文档|协调/, "docs-coordinator.png"],
			[/release|\bbuild\b|deploy|\bops\b|\bci\b|ship|发布|构建|部署/, "engineer.png"]
		];
		/** Captain artwork (always the lead whale). */
		const LEAD_ART = `${ART_BASE}team-lead.png`;
		/** Status action artwork per member activity. */
		const ACTION_ART = {
			working: `${ART_BASE}action-working.png`,
			idle: `${ART_BASE}action-sleeping.png`,
			unknown: `${ART_BASE}action-thinking.png`
		};
		/**
		* Member artwork URL, or null when no role matches (initial-letter fallback).
		* @param name - the member's display name.
		* @param role - the member's role text.
		* @returns the artwork URL, or null when unmatched.
		*/
		function memberArtUrl(name, role) {
			const identity = `${name} ${role}`.toLowerCase();
			for (const [pattern, art] of ROLE_ART) if (pattern.test(identity)) return `${ART_BASE}${art}`;
			return null;
		}
		//#endregion
		//#region \0dsh-css:/Users/nanmi/workspace/myself_code/dsh-agent-teams/src/client/AgentTeamsCard.module.css.mjs
		const css$1 = "._6Ci0pW_root{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module-platform);border-radius:10px;flex-direction:column;gap:8px;width:100%;min-width:0;padding:10px 12px;display:flex}._6Ci0pW_head{align-items:center;gap:8px;min-width:0;display:flex}._6Ci0pW_leadAvatar{border:1px solid var(--dsw-alias-line-strong);object-fit:cover;background:#0b1d33;border-radius:50%;flex:none;width:24px;height:24px}._6Ci0pW_teamName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:0 auto;font-size:13px;font-weight:600;line-height:20px;overflow:hidden}._6Ci0pW_memberCount{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;margin-left:auto;font-size:11px;line-height:16px}._6Ci0pW_panelButton{border:1px solid var(--dsw-alias-line-strong);background:var(--dsw-alias-bg-module);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;flex:none;padding:2px 8px;font-size:10.5px;font-weight:600;line-height:16px;transition:border-color .12s,color .12s}._6Ci0pW_panelButton:hover{border-color:var(--dsw-alias-state-business-primary);color:var(--dsw-alias-state-business-primary)}._6Ci0pW_panelButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._6Ci0pW_members{flex-wrap:wrap;gap:6px;min-width:0;display:flex}._6Ci0pW_member{border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);max-width:160px;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:5px;padding:3px 8px 3px 3px;font-size:11px;font-weight:500;line-height:16px;transition:border-color .12s,background-color .12s;display:inline-flex}._6Ci0pW_member:hover{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-fill-neutral)}._6Ci0pW_member:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}._6Ci0pW_memberArt{border:1px solid var(--dsw-alias-line-strong);object-fit:cover;background:#0b1d33;border-radius:50%;width:20px;height:20px}._6Ci0pW_memberInitial{background:var(--dsw-alias-bg-fill-business);width:20px;height:20px;color:var(--dsw-alias-label-on-fill);border-radius:50%;justify-content:center;align-items:center;font-size:10px;font-weight:600;line-height:20px;display:inline-flex}._6Ci0pW_memberName{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}";
		const tagId$1 = "dsh-agent-teams/AgentTeamsCard.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-agent-teams";
			tag.dataset.pluginCss = tagId$1;
			tag.textContent = css$1;
			document.head.appendChild(tag);
		}
		var AgentTeamsCard_module_css_default = {
			"leadAvatar": "_6Ci0pW_leadAvatar",
			"memberName": "_6Ci0pW_memberName",
			"memberInitial": "_6Ci0pW_memberInitial",
			"member": "_6Ci0pW_member",
			"memberCount": "_6Ci0pW_memberCount",
			"members": "_6Ci0pW_members",
			"root": "_6Ci0pW_root",
			"panelButton": "_6Ci0pW_panelButton",
			"teamName": "_6Ci0pW_teamName",
			"memberArt": "_6Ci0pW_memberArt",
			"head": "_6Ci0pW_head"
		};
		//#endregion
		//#region lib/client/AgentTeamsCard.js
		/** Window event name the floater listens for to open itself. */
		const OPEN_PANEL_EVENT = "agent-teams:open-panel";
		/** Re-activate the top-right activity panel, carrying this team's summary
		* so the panel can show it even when the team no longer exists on disk
		* (historical session review). */
		function openActivityPanel(data) {
			window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: {
				teamId: data.teamId,
				captainSessionId: data.captainSessionId,
				teamName: data.teamName,
				members: data.members
			} }));
		}
		/** Render one durable team as a compact conversation card. */
		function AgentTeamsCard({ node, openSession }) {
			const data = node.data;
			return (0, react_jsx_runtime.jsxs)("section", {
				className: AgentTeamsCard_module_css_default.root,
				"data-agent-teams-card": true,
				"data-team-id": data.teamId,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: AgentTeamsCard_module_css_default.head,
					children: [
						(0, react_jsx_runtime.jsx)("img", {
							className: AgentTeamsCard_module_css_default.leadAvatar,
							src: LEAD_ART,
							alt: "",
							"aria-hidden": true
						}),
						(0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.teamName,
							title: data.teamName,
							children: data.teamName
						}),
						(0, react_jsx_runtime.jsxs)("span", {
							className: AgentTeamsCard_module_css_default.memberCount,
							children: [data.members.length, " 名成员"]
						}),
						(0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: AgentTeamsCard_module_css_default.panelButton,
							onClick: () => {
								openActivityPanel(data);
							},
							"aria-label": "打开活动面板",
							title: "打开活动面板",
							children: "活动面板"
						})
					]
				}), data.members.length > 0 && (0, react_jsx_runtime.jsx)("div", {
					className: AgentTeamsCard_module_css_default.members,
					children: data.members.map((member) => (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: AgentTeamsCard_module_css_default.member,
						onClick: () => {
							if (member.id !== "") openSession(member.id);
						},
						title: member.role === "" ? member.name : `${member.name} · ${member.role}`,
						children: [memberArtUrl(member.name, member.role) !== null ? (0, react_jsx_runtime.jsx)("img", {
							className: AgentTeamsCard_module_css_default.memberArt,
							src: memberArtUrl(member.name, member.role) ?? "",
							alt: "",
							"aria-hidden": true
						}) : (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberInitial,
							children: member.name.trim().slice(0, 1).toUpperCase() || "?"
						}), (0, react_jsx_runtime.jsx)("span", {
							className: AgentTeamsCard_module_css_default.memberName,
							children: member.name
						})]
					}, member.id))
				})]
			});
		}
		//#endregion
		//#region \0dsh-css:/Users/nanmi/workspace/myself_code/dsh-agent-teams/src/client/ActivityPanel.module.css.mjs
		const css = "html{--agent-teams-panel-width:388px;--agent-teams-panel-right:calc(18px + var(--dsh-sidebar-width, 0px));--agent-teams-panel-gap:14px;--agent-teams-panel-shift:calc(var(--agent-teams-panel-width) + 18px + var(--agent-teams-panel-gap))}html[data-agent-teams-panel-open] [data-phase=active]{box-sizing:border-box;padding-right:var(--agent-teams-panel-shift)}[data-phase=active]{will-change:padding-right;transition:padding-right .36s cubic-bezier(.22,1,.36,1)}.qZToFW_badge{top:64px;right:var(--agent-teams-panel-right);z-index:2147483000;box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 92%, transparent);backdrop-filter:blur(16px);height:34px;box-shadow:0 8px 28px color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;border-radius:999px;align-items:center;gap:7px;padding:0 12px;font-size:12px;font-weight:600;line-height:20px;transition:border-color .15s,transform .12s;display:inline-flex;position:fixed}.qZToFW_badge:hover{border-color:var(--dsw-alias-line-strong);transform:translateY(-1px)}.qZToFW_badge:active{transform:translateY(0)scale(.98)}.qZToFW_badge:focus-visible,.qZToFW_closeButton:focus-visible,.qZToFW_memberRow:focus-visible,.qZToFW_taskNode:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.qZToFW_badgeDot,.qZToFW_panelDot{background:var(--dsw-alias-label-tertiary);border-radius:50%;width:7px;height:7px}.qZToFW_badgeDot[data-busy=true],.qZToFW_panelDot[data-busy=true]{background:var(--dsw-alias-state-business-primary);animation:1.25s ease-in-out infinite qZToFW_agentTeamsPulse}.qZToFW_badgeCount,.qZToFW_memberCount,.qZToFW_teamStats,.qZToFW_stageLabel,.qZToFW_taskId{font-variant-numeric:tabular-nums}.qZToFW_panel{top:64px;right:var(--agent-teams-panel-right);z-index:2147483000;width:min(var(--agent-teams-panel-width), calc(100vw - 24px));box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-line-strong) 58%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-module-platform) 95%, transparent);backdrop-filter:blur(20px)saturate(1.08);max-height:70dvh;box-shadow:0 12px 32px color-mix(in srgb, var(--dsw-alias-label-primary) 12%, transparent), 0 32px 72px color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);border-radius:16px;flex-direction:column;animation:.18s ease-out qZToFW_agentTeamsPanelIn;display:flex;position:fixed;overflow:hidden}@keyframes qZToFW_agentTeamsPanelIn{0%{opacity:0;transform:translateY(-6px)scale(.99)}to{opacity:1;transform:translateY(0)scale(1)}}@keyframes qZToFW_agentTeamsPulse{0%,to{opacity:.42}50%{opacity:1}}.qZToFW_panelHead{border-bottom:1px solid var(--dsw-alias-line-normal);flex:none;justify-content:space-between;align-items:center;min-height:44px;padding:0 14px 0 16px;display:flex}.qZToFW_panelTitle{color:var(--dsw-alias-label-primary);align-items:center;gap:8px;font-size:14px;font-weight:600;line-height:20px;display:inline-flex}.qZToFW_closeButton{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:7px;justify-content:center;align-items:center;padding:0;transition:background-color .12s,color .12s,transform .12s;display:inline-flex}.qZToFW_closeButton:hover{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-primary)}.qZToFW_closeButton:active{transform:scale(.94)}.qZToFW_teams{overscroll-behavior:contain;flex-direction:column;min-height:0;display:flex;overflow-y:auto}.qZToFW_team{border-bottom:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:12px;padding:12px 14px 16px;display:flex}.qZToFW_team:last-child{border-bottom:0}.qZToFW_teamHead{align-items:center;gap:10px;min-width:0;display:flex}.qZToFW_teamName{min-width:0;color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:13px;font-weight:600;line-height:18px;overflow:hidden}.qZToFW_teamStats{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;gap:8px;font-size:10.5px;line-height:16px;display:inline-flex}.qZToFW_sectionHead{justify-content:space-between;align-items:center;gap:8px;min-width:0;display:flex}.qZToFW_sectionTitle{color:var(--dsw-alias-label-secondary);align-items:center;gap:6px;font-size:11px;font-weight:600;line-height:16px;display:inline-flex}.qZToFW_sectionHint{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.qZToFW_delegationSection{min-width:0}.qZToFW_captainNode{box-sizing:border-box;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 32%, var(--dsw-alias-line-normal));background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 7%, var(--dsw-alias-bg-module));border-radius:10px;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:9px;min-height:48px;padding:8px 10px;display:grid}.qZToFW_captainAvatar,.qZToFW_memberAvatar{flex:none;justify-content:center;align-items:center;display:inline-flex;position:relative}.qZToFW_captainAvatar{width:36px;height:36px}.qZToFW_leadAvatar,.qZToFW_memberArt,.qZToFW_memberInitial{box-sizing:border-box;border:1px solid var(--dsw-alias-line-strong);object-fit:cover;background:#0b1d33;border-radius:50%;width:34px;height:34px}.qZToFW_captainInfo,.qZToFW_memberInfo{flex-direction:column;min-width:0;display:flex}.qZToFW_captainInfo{gap:2px}.qZToFW_captainLine,.qZToFW_memberLine{align-items:center;gap:6px;min-width:0;display:flex}.qZToFW_captainName,.qZToFW_memberName{color:var(--dsw-alias-label-primary);text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:600;line-height:18px;overflow:hidden}.qZToFW_captainRole,.qZToFW_memberRole{color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.qZToFW_captainSummary,.qZToFW_memberStatusLine{color:var(--dsw-alias-label-secondary);text-overflow:ellipsis;white-space:nowrap;font-size:10.5px;line-height:15px;overflow:hidden}.qZToFW_captainState,.qZToFW_memberState{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;align-items:center;gap:5px;font-size:10px;font-weight:500;line-height:15px;display:inline-flex}.qZToFW_captainState[data-busy=true],.qZToFW_memberState[data-activity=working]{color:var(--dsw-alias-state-business-primary)}.qZToFW_delegationTree{flex-direction:column;gap:2px;margin-left:18px;padding:9px 0 0 20px;display:flex;position:relative}.qZToFW_delegationTree:before{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-line-normal));content:\"\";width:1px;position:absolute;top:0;bottom:22px;left:0}.qZToFW_memberBlock{flex-direction:column;min-width:0;padding:3px 0 7px;display:flex;position:relative}.qZToFW_memberBranch{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 48%, var(--dsw-alias-line-normal));width:20px;height:1px;display:block;position:absolute;top:23px;right:100%}.qZToFW_memberBranch:before{background:var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;width:5px;height:5px;position:absolute;top:-2px;right:-1px}.qZToFW_memberRow{box-sizing:border-box;width:100%;min-width:0;min-height:44px;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:8px;grid-template-columns:38px minmax(0,1fr) auto;align-items:center;gap:8px;padding:4px 6px;transition:background-color .12s,transform .12s;display:grid}.qZToFW_memberRow:hover,.qZToFW_memberRow[data-activity=working]{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-module))}.qZToFW_memberRow:active{transform:scale(.995)}.qZToFW_memberAvatar{width:34px;height:34px}.qZToFW_memberAvatar[data-unread=true]:after{border:1px solid var(--dsw-alias-state-business-primary);content:\"\";border-radius:50%;animation:1.5s ease-out infinite qZToFW_agentTeamsRing;position:absolute;inset:-3px}@keyframes qZToFW_agentTeamsRing{0%{opacity:.82;transform:scale(.94)}75%,to{opacity:0;transform:scale(1.18)}}.qZToFW_memberInitial{color:var(--dsw-alias-label-on-fill);justify-content:center;align-items:center;font-size:14px;font-weight:600;line-height:20px;display:inline-flex}.qZToFW_stateArt{box-sizing:border-box;border:2px solid var(--dsw-alias-bg-module-platform);object-fit:cover;background:#0b1d33;border-radius:50%;width:19px;height:19px;position:absolute;bottom:-4px;right:-4px}.qZToFW_stateArt[data-activity=working]{animation:2.4s ease-in-out infinite qZToFW_agentTeamsFloat}.qZToFW_stateArt[data-activity=idle]{animation:4.2s ease-in-out infinite qZToFW_agentTeamsBreathe}.qZToFW_stateArt[data-activity=unknown]{animation:2.8s ease-in-out infinite qZToFW_agentTeamsThink}@keyframes qZToFW_agentTeamsFloat{0%,to{transform:translateY(0)rotate(-4deg)}50%{transform:translateY(-2px)rotate(4deg)}}@keyframes qZToFW_agentTeamsBreathe{0%,to{opacity:.82;transform:scale(1)}50%{opacity:1;transform:scale(1.06)}}@keyframes qZToFW_agentTeamsThink{0%,to{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}.qZToFW_memberState{margin-left:auto}.qZToFW_memberCount{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:16px}.qZToFW_assignmentLine{align-items:center;gap:7px;min-width:0;padding:0 6px 0 52px;display:flex}.qZToFW_assignmentLabel{color:var(--dsw-alias-label-tertiary);flex:none;font-size:9.5px;line-height:14px}.qZToFW_assignmentTasks{flex-wrap:wrap;flex:1;gap:4px;min-width:0;display:flex}.qZToFW_assignmentChip{background:var(--dsw-alias-bg-fill-neutral);min-height:16px;color:var(--dsw-alias-label-secondary);border-radius:4px;align-items:center;padding:0 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;font-weight:600;line-height:14px;display:inline-flex}.qZToFW_assignmentChip[data-state=running]{background:var(--dsw-alias-bg-fill-business);color:var(--dsw-alias-label-on-fill)}.qZToFW_assignmentChip[data-state=completed]{background:var(--dsw-alias-bg-fill-success);color:var(--dsw-alias-label-on-fill)}.qZToFW_assignmentChip[data-state=blocked]{background:var(--dsw-alias-bg-fill-warning);color:var(--dsw-alias-label-on-fill)}.qZToFW_assignmentChip[data-state=failed]{background:var(--dsw-alias-bg-fill-danger);color:var(--dsw-alias-label-on-fill)}.qZToFW_assignmentChip[data-state=cancelled]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}.qZToFW_unreadPill{color:var(--dsw-alias-state-business-primary);white-space:nowrap;flex:none;font-size:9.5px;font-weight:600;line-height:14px}.qZToFW_taskEmpty{color:var(--dsw-alias-label-tertiary);font-size:9.5px;line-height:14px}.qZToFW_dependencySection{border-top:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:7px;min-width:0;padding-top:10px;display:flex}.qZToFW_stageFlow{scrollbar-width:thin;align-items:stretch;gap:0;min-width:0;padding:1px 1px 5px;display:flex;overflow-x:auto}.qZToFW_stageGroup{flex:1 0 126px;min-width:126px;display:flex;position:relative}.qZToFW_stageConnector{width:22px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;align-items:center;margin-top:0;display:flex}.qZToFW_stageLine{background:var(--dsw-alias-line-strong);flex:1;height:1px;display:block}.qZToFW_stageColumn{flex-direction:column;flex:1;gap:5px;min-width:0;display:flex}.qZToFW_stageLabel{color:var(--dsw-alias-label-tertiary);justify-content:space-between;align-items:center;gap:6px;padding:0 2px;font-size:9.5px;font-weight:600;line-height:14px;display:flex}.qZToFW_stageLabel span{background:var(--dsw-alias-bg-fill-neutral);border-radius:4px;justify-content:center;align-items:center;min-width:14px;height:14px;font-size:8.5px;display:inline-flex}.qZToFW_stageTasks{flex-direction:column;gap:5px;display:flex}.qZToFW_taskNode{box-sizing:border-box;border:1px solid var(--dsw-alias-line-normal);background:var(--dsw-alias-bg-module);min-width:0;min-height:72px;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;border-radius:8px;flex-direction:column;gap:4px;padding:7px 8px;transition:border-color .14s,opacity .14s,transform .12s,background-color .14s;display:flex}.qZToFW_taskNode:hover,.qZToFW_taskNode[data-focused=true]{border-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-module));transform:translateY(-1px)}.qZToFW_taskNode[data-dimmed=true]{opacity:.34}.qZToFW_taskNode[data-state=completed]{border-color:color-mix(in srgb, var(--dsw-alias-state-success) 48%, var(--dsw-alias-line-normal))}.qZToFW_taskNode[data-state=blocked]{border-color:color-mix(in srgb, var(--dsw-alias-state-warning) 52%, var(--dsw-alias-line-normal))}.qZToFW_taskNode[data-state=failed]{border-color:color-mix(in srgb, var(--dsw-alias-state-danger) 56%, var(--dsw-alias-line-normal))}.qZToFW_taskNodeHead,.qZToFW_taskRoute{justify-content:space-between;align-items:center;gap:5px;min-width:0;display:flex}.qZToFW_taskId{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9.5px;font-weight:700}.qZToFW_taskBadge{background:var(--dsw-alias-bg-fill-neutral);min-height:14px;color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;align-items:center;padding:0 4px;font-size:8.5px;font-weight:600;line-height:13px;display:inline-flex}.qZToFW_taskBadge[data-state=running]{background:var(--dsw-alias-bg-fill-business);color:var(--dsw-alias-label-on-fill)}.qZToFW_taskBadge[data-state=completed]{background:var(--dsw-alias-bg-fill-success);color:var(--dsw-alias-label-on-fill)}.qZToFW_taskBadge[data-state=blocked]{background:var(--dsw-alias-bg-fill-warning);color:var(--dsw-alias-label-on-fill)}.qZToFW_taskBadge[data-state=failed]{background:var(--dsw-alias-bg-fill-danger);color:var(--dsw-alias-label-on-fill)}.qZToFW_taskBadge[data-state=cancelled]{color:var(--dsw-alias-label-tertiary);text-decoration:line-through}.qZToFW_taskSubject{min-height:30px;color:var(--dsw-alias-label-primary);-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:10.5px;font-weight:500;line-height:15px;display:-webkit-box;overflow:hidden}.qZToFW_taskRoute{color:var(--dsw-alias-label-tertiary);margin-top:auto;font-size:8.5px;line-height:13px}.qZToFW_taskOwner,.qZToFW_taskDeps{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.qZToFW_taskOwner{max-width:48%;color:var(--dsw-alias-label-secondary);font-weight:600}.qZToFW_taskDeps{text-align:right;flex:1}.qZToFW_taskStart{color:var(--dsw-alias-label-tertiary)}.qZToFW_unclaimed,.qZToFW_inbox{border-top:1px solid var(--dsw-alias-line-normal);flex-direction:column;gap:5px;min-width:0;padding-top:10px;display:flex}.qZToFW_unclaimedTitle{color:var(--dsw-alias-label-secondary);font-size:10.5px;font-weight:600;line-height:15px}.qZToFW_inboxRow{border-radius:6px;grid-template-columns:112px minmax(0,1fr);align-items:center;gap:8px;min-width:0;min-height:24px;padding:2px 5px;display:grid}.qZToFW_inboxRow:hover{background:var(--dsw-alias-bg-module)}.qZToFW_inboxRoute{min-width:0;color:var(--dsw-alias-state-business-primary);text-overflow:ellipsis;white-space:nowrap;align-items:center;gap:3px;font-size:9.5px;font-weight:600;line-height:14px;display:inline-flex;overflow:hidden}.qZToFW_inboxContent{min-width:0;color:var(--dsw-alias-label-tertiary);text-overflow:ellipsis;white-space:nowrap;font-size:10px;line-height:14px;overflow:hidden}.qZToFW_emptyHint{color:var(--dsw-alias-label-tertiary);padding:10px 12px;font-size:11px;line-height:16px}.qZToFW_team[data-historic],.qZToFW_archivedWrap{opacity:.82}.qZToFW_historicPill{background:var(--dsw-alias-bg-fill-neutral);color:var(--dsw-alias-label-tertiary);border-radius:4px;flex:none;margin-left:auto;padding:1px 7px;font-size:9.5px;font-weight:600;line-height:15px}.qZToFW_members{flex-direction:column;gap:3px;display:flex}.qZToFW_archivedWrap:before{color:var(--dsw-alias-label-tertiary);content:\"已结束 · 历史归档\";padding:5px 14px 0;font-size:9.5px;font-weight:600;line-height:14px;display:block}@media (prefers-reduced-motion:reduce){[data-phase=active],.qZToFW_panel,.qZToFW_badge,.qZToFW_badgeDot,.qZToFW_panelDot,.qZToFW_stateArt,.qZToFW_memberAvatar[data-unread=true]:after{transition:none;animation:none}}@media (width<=960px){html{--agent-teams-main-shift:0px}html[data-agent-teams-panel-open] [data-phase=active]{padding-right:0}}@media (width<=640px){html{--agent-teams-panel-right:calc(10px + var(--dsh-sidebar-width, 0px))}.qZToFW_panel{width:auto;max-height:calc(100dvh - 68px);top:56px;left:10px}.qZToFW_badge{top:56px}.qZToFW_teamStats span[data-stat=messages]{display:none}.qZToFW_captainNode{grid-template-columns:38px minmax(0,1fr)}.qZToFW_captainState{display:none}.qZToFW_delegationTree{margin-left:12px;padding-left:15px}.qZToFW_memberBranch{width:15px}.qZToFW_assignmentLine{padding-left:45px}}";
		const tagId = "dsh-agent-teams/ActivityPanel.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-agent-teams";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var ActivityPanel_module_css_default = {
			"unreadPill": "qZToFW_unreadPill",
			"stateArt": "qZToFW_stateArt",
			"sectionHint": "qZToFW_sectionHint",
			"memberArt": "qZToFW_memberArt",
			"stageConnector": "qZToFW_stageConnector",
			"stageTasks": "qZToFW_stageTasks",
			"taskSubject": "qZToFW_taskSubject",
			"inboxRoute": "qZToFW_inboxRoute",
			"members": "qZToFW_members",
			"inboxContent": "qZToFW_inboxContent",
			"stageGroup": "qZToFW_stageGroup",
			"closeButton": "qZToFW_closeButton",
			"sectionTitle": "qZToFW_sectionTitle",
			"memberName": "qZToFW_memberName",
			"team": "qZToFW_team",
			"panelTitle": "qZToFW_panelTitle",
			"assignmentLabel": "qZToFW_assignmentLabel",
			"inbox": "qZToFW_inbox",
			"assignmentChip": "qZToFW_assignmentChip",
			"memberBranch": "qZToFW_memberBranch",
			"panelDot": "qZToFW_panelDot",
			"panel": "qZToFW_panel",
			"leadAvatar": "qZToFW_leadAvatar",
			"memberLine": "qZToFW_memberLine",
			"panelHead": "qZToFW_panelHead",
			"assignmentLine": "qZToFW_assignmentLine",
			"memberStatusLine": "qZToFW_memberStatusLine",
			"delegationTree": "qZToFW_delegationTree",
			"taskBadge": "qZToFW_taskBadge",
			"stageLabel": "qZToFW_stageLabel",
			"captainInfo": "qZToFW_captainInfo",
			"memberInitial": "qZToFW_memberInitial",
			"teamStats": "qZToFW_teamStats",
			"agentTeamsPanelIn": "qZToFW_agentTeamsPanelIn",
			"memberRow": "qZToFW_memberRow",
			"agentTeamsFloat": "qZToFW_agentTeamsFloat",
			"taskNodeHead": "qZToFW_taskNodeHead",
			"stageColumn": "qZToFW_stageColumn",
			"captainNode": "qZToFW_captainNode",
			"taskRoute": "qZToFW_taskRoute",
			"teams": "qZToFW_teams",
			"taskOwner": "qZToFW_taskOwner",
			"unclaimedTitle": "qZToFW_unclaimedTitle",
			"dependencySection": "qZToFW_dependencySection",
			"memberInfo": "qZToFW_memberInfo",
			"badge": "qZToFW_badge",
			"captainName": "qZToFW_captainName",
			"stageFlow": "qZToFW_stageFlow",
			"memberCount": "qZToFW_memberCount",
			"archivedWrap": "qZToFW_archivedWrap",
			"memberBlock": "qZToFW_memberBlock",
			"taskDeps": "qZToFW_taskDeps",
			"delegationSection": "qZToFW_delegationSection",
			"captainLine": "qZToFW_captainLine",
			"assignmentTasks": "qZToFW_assignmentTasks",
			"badgeDot": "qZToFW_badgeDot",
			"memberRole": "qZToFW_memberRole",
			"captainState": "qZToFW_captainState",
			"agentTeamsBreathe": "qZToFW_agentTeamsBreathe",
			"captainAvatar": "qZToFW_captainAvatar",
			"taskId": "qZToFW_taskId",
			"sectionHead": "qZToFW_sectionHead",
			"taskEmpty": "qZToFW_taskEmpty",
			"emptyHint": "qZToFW_emptyHint",
			"taskStart": "qZToFW_taskStart",
			"memberState": "qZToFW_memberState",
			"agentTeamsRing": "qZToFW_agentTeamsRing",
			"inboxRow": "qZToFW_inboxRow",
			"teamName": "qZToFW_teamName",
			"captainSummary": "qZToFW_captainSummary",
			"taskNode": "qZToFW_taskNode",
			"teamHead": "qZToFW_teamHead",
			"agentTeamsThink": "qZToFW_agentTeamsThink",
			"historicPill": "qZToFW_historicPill",
			"stageLine": "qZToFW_stageLine",
			"memberAvatar": "qZToFW_memberAvatar",
			"captainRole": "qZToFW_captainRole",
			"unclaimed": "qZToFW_unclaimed",
			"agentTeamsPulse": "qZToFW_agentTeamsPulse",
			"badgeCount": "qZToFW_badgeCount"
		};
		//#endregion
		//#region lib/client/ActivityPanel.js
		/**
		* AgentTeams activity panel: the top-right floater monitoring every team.
		*
		* Modeled on the Claude Code desktop SessionActivityPanel: a fixed glass
		* panel at the top-right corner. On wide viewports it cooperatively makes the
		* conversation column yield space; narrow viewports keep overlay mode. It
		* polls the host `/plugins/dsh-agent-teams/state` route for
		* server-side snapshots (durable files + live subagent activity), with a
		* collapsed badge that auto-expands once when activity appears and collapses
		* 2s after the last team disappears.
		*
		* The floater mounts through a body portal (no top-right slot exists in the
		* web shell); it is not a conversation node — the in-conversation panel was
		* removed in favor of this always-available monitor.
		* @module dsh-agent-teams/client/activity
		*/
		/** Poll cadence for the host snapshot route. */
		const POLL_MS = 1e3;
		/** Grace before the panel collapses once no team remains. */
		const AUTOCLOSE_GRACE_MS = 2e3;
		/**
		* Page-settle window after mount: activity restored on page load only shows
		* the collapsed badge, so the panel never yanks the conversation column
		* right after load. New activity after this window auto-expands as usual.
		*/
		const AUTO_OPEN_SETTLE_MS = 4e3;
		/** Host route serving team snapshots. */
		const STATE_URL = "/plugins/dsh-agent-teams/state";
		/** Root marker shared with the panel CSS while the portal is expanded. */
		const PANEL_OPEN_ATTRIBUTE = "data-agent-teams-panel-open";
		/** Initial-letter fallback for unmatched roles. */
		function memberInitial(name) {
			return name.trim().slice(0, 1).toUpperCase() || "?";
		}
		function stableHash(value) {
			let hash = 0;
			for (let index = 0; index < value.length; index += 1) hash = (hash << 5) - hash + value.charCodeAt(index) | 0;
			return Math.abs(hash);
		}
		const ACCENTS = [
			"var(--dsw-alias-state-business-primary)",
			"var(--dsw-alias-state-success)",
			"var(--dsw-alias-state-danger)",
			"var(--dsw-alias-state-warning)",
			"var(--dsw-alias-label-tertiary)"
		];
		function accentOf(id) {
			return ACCENTS[stableHash(id) % ACCENTS.length] ?? ACCENTS[0];
		}
		/** Badge text follows the raw task status (finer than the 4 visual states):
		* claimed/pending/failed/cancelled keep their own labels and colors. */
		const TASK_STATUS_LABEL = {
			pending: "待领取",
			claimed: "已认领",
			in_progress: "进行中",
			completed: "已完成",
			failed: "失败",
			cancelled: "已取消"
		};
		function taskStatusLabel(status) {
			return TASK_STATUS_LABEL[status] ?? status;
		}
		/** Badge/bar coloring key: visual state, widened for terminal statuses. */
		function taskTone(state, status) {
			if (status === "failed") return "failed";
			if (status === "cancelled") return "cancelled";
			return state;
		}
		/** Collapsed badge: an always-visible corner pill while any team exists. */
		function CollapsedBadge({ count, busy, onClick }) {
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ActivityPanel_module_css_default.badge,
				"data-busy": busy,
				onClick,
				"aria-label": `AgentTeams 活动，${count} 个团队`,
				children: [(0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeDot,
					"data-busy": busy,
					"aria-hidden": true
				}), (0, react_jsx_runtime.jsx)("span", {
					className: ActivityPanel_module_css_default.badgeCount,
					children: count
				})]
			});
		}
		function memberDotState(member, tasks) {
			const owned = tasks.filter((task) => task.assignee === member.name);
			if (member.activity === "working") return "ongoing";
			if (owned.some((task) => task.status === "failed")) return "error";
			if (owned.length > 0 && owned.every((task) => task.status === "completed")) return "done";
			return "warning";
		}
		function memberStateLabel(member, tasks) {
			const owned = tasks.filter((task) => task.assignee === member.name);
			if (member.activity === "working") return "工作中";
			if (owned.some((task) => task.status === "failed")) return "有失败";
			if (owned.some((task) => task.state === "blocked")) return "等待";
			if (owned.length > 0 && owned.every((task) => task.status === "completed")) return "已交付";
			if (owned.length > 0) return "待执行";
			return "待派工";
		}
		function memberStatusText(member, tasks) {
			const owned = tasks.filter((task) => task.assignee === member.name);
			const current = owned.find((task) => task.id === member.currentTask);
			const blocked = owned.find((task) => task.state === "blocked");
			if (member.activity === "working" && current !== void 0) return `正在执行 ${current.id}`;
			if (member.activity === "working") return "正在处理已派任务";
			if (blocked !== void 0) {
				const dependency = tasks.find((task) => blocked.dependencies.includes(task.id) && task.state !== "completed");
				if (dependency !== void 0) return `等待 ${dependency.id} · ${dependency.assignee || "待认领"}`;
				return "等待前置任务";
			}
			if (member.total === 0) return "等待队长派工";
			if (member.done === member.total) return "任务已交付";
			return member.activity === "idle" ? "待继续执行" : "状态未知";
		}
		function dependencyLabel(task, tasks) {
			return task.dependencies.map((id) => {
				const dependency = tasks.find((candidate) => candidate.id === id);
				return dependency?.assignee ? `${id}·${dependency.assignee}` : id;
			}).join("、");
		}
		function TaskNode({ task, tasks, focused, dimmed, pinned, onPin, onPreview }) {
			const tone = taskTone(task.state, task.status);
			return (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: ActivityPanel_module_css_default.taskNode,
				"data-task-id": task.id,
				"data-state": tone,
				"data-focused": focused,
				"data-dimmed": dimmed,
				"aria-pressed": pinned,
				title: `${task.id} · ${task.subject}（点击固定依赖链）`,
				onClick: () => {
					onPin(task.id);
				},
				onMouseEnter: () => {
					onPreview(task.id);
				},
				onMouseLeave: () => {
					onPreview(null);
				},
				onFocus: () => {
					onPreview(task.id);
				},
				onBlur: () => {
					onPreview(null);
				},
				children: [
					(0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.taskNodeHead,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskId,
							children: task.id
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskBadge,
							"data-state": tone,
							children: taskStatusLabel(task.status)
						})]
					}),
					(0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.taskSubject,
						children: task.subject
					}),
					(0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.taskRoute,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskOwner,
							children: task.assignee || "待认领"
						}), task.dependencies.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.taskStart,
							children: "起点"
						}) : (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.taskDeps,
							children: ["依赖 ", dependencyLabel(task, tasks)]
						})]
					})
				]
			});
		}
		function DependencyMap({ tasks }) {
			const [previewTaskId, setPreviewTaskId] = (0, react.useState)(null);
			const [pinnedTaskId, setPinnedTaskId] = (0, react.useState)(null);
			const focusedTaskId = pinnedTaskId ?? previewTaskId;
			const stages = (0, react.useMemo)(() => taskStages(tasks), [tasks]);
			const related = (0, react.useMemo)(() => focusedTaskId === null ? null : relatedTaskIds(focusedTaskId, tasks), [focusedTaskId, tasks]);
			(0, react.useEffect)(() => {
				const onKeyDown = (event) => {
					if (event.key === "Escape") setPinnedTaskId(null);
				};
				window.addEventListener("keydown", onKeyDown);
				return () => {
					window.removeEventListener("keydown", onKeyDown);
				};
			}, []);
			if (tasks.length === 0) return null;
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.dependencySection,
				"aria-label": "任务依赖链",
				"data-dependency-map": true,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: ActivityPanel_module_css_default.sectionHead,
					children: [(0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.sectionTitle,
						children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}), " 任务依赖"]
					}), (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.sectionHint,
						children: pinnedTaskId === null ? "悬停预览 · 点击固定" : `${pinnedTaskId} 已固定 · Esc 取消`
					})]
				}), (0, react_jsx_runtime.jsx)("div", {
					className: ActivityPanel_module_css_default.stageFlow,
					children: stages.map((stage, index) => (0, react_jsx_runtime.jsxs)("div", {
						className: ActivityPanel_module_css_default.stageGroup,
						"data-depth": stage.depth,
						children: [index > 0 && (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.stageConnector,
							"aria-hidden": true,
							children: [(0, react_jsx_runtime.jsx)("span", { className: ActivityPanel_module_css_default.stageLine }), (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {})]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: ActivityPanel_module_css_default.stageColumn,
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.stageLabel,
								children: [stage.depth === 0 ? "起点" : `依赖层 ${stage.depth}`, (0, react_jsx_runtime.jsx)("span", { children: stage.tasks.length })]
							}), (0, react_jsx_runtime.jsx)("div", {
								className: ActivityPanel_module_css_default.stageTasks,
								children: stage.tasks.map((task) => (0, react_jsx_runtime.jsx)(TaskNode, {
									task,
									tasks,
									focused: related?.has(task.id) ?? false,
									dimmed: related !== null && !related.has(task.id),
									pinned: pinnedTaskId === task.id,
									onPin: (id) => {
										setPinnedTaskId((current) => current === id ? null : id);
									},
									onPreview: setPreviewTaskId
								}, task.id))
							})]
						})]
					}, stage.depth))
				})]
			});
		}
		function TeamSection({ team, onNavigate }) {
			const busyCount = team.members.filter((member) => member.activity === "working").length;
			const assignedCount = team.tasks.filter((task) => task.assignee !== "").length;
			const completedCount = team.tasks.filter((task) => task.status === "completed").length;
			const allCompleted = team.tasks.length > 0 && completedCount === team.tasks.length;
			const unclaimed = team.tasks.filter((task) => {
				if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") return false;
				if (task.assignee === "") return true;
				return !team.members.some((member) => member.name === task.assignee);
			});
			return (0, react_jsx_runtime.jsxs)("section", {
				className: ActivityPanel_module_css_default.team,
				"data-team-id": team.teamId,
				children: [
					(0, react_jsx_runtime.jsxs)("header", {
						className: ActivityPanel_module_css_default.teamHead,
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.teamName,
							title: team.name,
							children: team.name
						}), (0, react_jsx_runtime.jsxs)("span", {
							className: ActivityPanel_module_css_default.teamStats,
							children: [
								(0, react_jsx_runtime.jsxs)("span", {
									"data-stat": "members",
									children: [team.members.length, " 成员"]
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									"data-stat": "tasks",
									children: [
										completedCount,
										"/",
										team.tasks.length,
										" 完成"
									]
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									"data-stat": "messages",
									children: [team.messageCount, " 消息"]
								})
							]
						})]
					}),
					(0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.delegationSection,
						"aria-label": "队长派工关系",
						"data-delegation-map": true,
						children: [(0, react_jsx_runtime.jsxs)("div", {
							className: ActivityPanel_module_css_default.captainNode,
							children: [
								(0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.captainAvatar,
									children: (0, react_jsx_runtime.jsx)("img", {
										className: ActivityPanel_module_css_default.leadAvatar,
										src: LEAD_ART,
										alt: "",
										"aria-hidden": true
									})
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.captainInfo,
									children: [(0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.captainLine,
										children: [(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.captainName,
											children: "队长"
										}), (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.captainRole,
											children: "拆解 · 派发 · 汇总"
										})]
									}), (0, react_jsx_runtime.jsxs)("span", {
										className: ActivityPanel_module_css_default.captainSummary,
										children: [
											"已派发 ",
											assignedCount,
											" 项任务给 ",
											team.members.length,
											" 名成员"
										]
									})]
								}),
								(0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.captainState,
									"data-busy": busyCount > 0,
									children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: busyCount > 0 ? "ongoing" : allCompleted ? "done" : "warning" }), busyCount > 0 ? `${busyCount} 人执行中` : allCompleted ? "已收齐" : "等待回报"]
								})
							]
						}), (0, react_jsx_runtime.jsxs)("div", {
							className: ActivityPanel_module_css_default.delegationTree,
							children: [team.members.length === 0 && (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.emptyHint,
								children: "暂无成员，等待队长组建团队"
							}), team.members.map((member) => {
								const owned = team.tasks.filter((task) => task.assignee === member.name);
								return (0, react_jsx_runtime.jsxs)("div", {
									className: ActivityPanel_module_css_default.memberBlock,
									"data-activity": member.activity,
									children: [
										(0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberBranch,
											"aria-hidden": true,
											children: (0, react_jsx_runtime.jsx)("span", {})
										}),
										(0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: ActivityPanel_module_css_default.memberRow,
											"data-activity": member.activity,
											onClick: () => {
												if (member.id !== "") onNavigate(member.id);
											},
											children: [
												(0, react_jsx_runtime.jsxs)("span", {
													className: ActivityPanel_module_css_default.memberAvatar,
													"data-unread": member.unread > 0,
													children: [memberArtUrl(member.name, member.role) !== null ? (0, react_jsx_runtime.jsx)("img", {
														className: ActivityPanel_module_css_default.memberArt,
														src: memberArtUrl(member.name, member.role) ?? "",
														alt: "",
														"aria-hidden": true
													}) : (0, react_jsx_runtime.jsx)("span", {
														className: ActivityPanel_module_css_default.memberInitial,
														style: { background: accentOf(member.id) },
														children: memberInitial(member.name)
													}), (0, react_jsx_runtime.jsx)("img", {
														className: ActivityPanel_module_css_default.stateArt,
														"data-activity": member.activity,
														src: ACTION_ART[member.activity],
														alt: "",
														"aria-hidden": true
													})]
												}),
												(0, react_jsx_runtime.jsxs)("span", {
													className: ActivityPanel_module_css_default.memberInfo,
													children: [(0, react_jsx_runtime.jsxs)("span", {
														className: ActivityPanel_module_css_default.memberLine,
														children: [
															(0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.memberName,
																children: member.name
															}),
															member.role !== "" && (0, react_jsx_runtime.jsx)("span", {
																className: ActivityPanel_module_css_default.memberRole,
																children: member.role
															}),
															(0, react_jsx_runtime.jsxs)("span", {
																className: ActivityPanel_module_css_default.memberState,
																"data-activity": member.activity,
																children: [(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, { state: memberDotState(member, team.tasks) }), memberStateLabel(member, team.tasks)]
															})
														]
													}), (0, react_jsx_runtime.jsx)("span", {
														className: ActivityPanel_module_css_default.memberStatusLine,
														children: memberStatusText(member, team.tasks)
													})]
												}),
												(0, react_jsx_runtime.jsxs)("span", {
													className: ActivityPanel_module_css_default.memberCount,
													children: [
														member.done,
														"/",
														member.total
													]
												})
											]
										}),
										(0, react_jsx_runtime.jsxs)("div", {
											className: ActivityPanel_module_css_default.assignmentLine,
											children: [
												(0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.assignmentLabel,
													children: "队长派发"
												}),
												(0, react_jsx_runtime.jsx)("span", {
													className: ActivityPanel_module_css_default.assignmentTasks,
													children: owned.length === 0 ? (0, react_jsx_runtime.jsx)("span", {
														className: ActivityPanel_module_css_default.taskEmpty,
														children: "暂无任务"
													}) : owned.map((task) => (0, react_jsx_runtime.jsx)("span", {
														className: ActivityPanel_module_css_default.assignmentChip,
														"data-state": taskTone(task.state, task.status),
														title: task.subject,
														children: task.id
													}, task.id))
												}),
												member.unread > 0 && (0, react_jsx_runtime.jsxs)("span", {
													className: ActivityPanel_module_css_default.unreadPill,
													children: [member.unread, " 条消息"]
												})
											]
										})
									]
								}, member.id);
							})]
						})]
					}),
					(0, react_jsx_runtime.jsx)(DependencyMap, { tasks: team.tasks }),
					unclaimed.length > 0 && (0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.unclaimed,
						"aria-label": "待认领任务",
						children: [(0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.unclaimedTitle,
							children: "待队长认领或改派"
						}), (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.assignmentTasks,
							children: unclaimed.map((task) => (0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.assignmentChip,
								"data-state": taskTone(task.state, task.status),
								title: task.subject,
								children: [
									task.id,
									" · ",
									task.assignee || "未分配"
								]
							}, task.id))
						})]
					}),
					team.captainInbox.length > 0 && (0, react_jsx_runtime.jsxs)("section", {
						className: ActivityPanel_module_css_default.inbox,
						"aria-label": "成员回报队长",
						children: [(0, react_jsx_runtime.jsxs)("header", {
							className: ActivityPanel_module_css_default.sectionHead,
							children: [(0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.sectionTitle,
								children: "成员回报"
							}), (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.sectionHint,
								children: "流向队长"
							})]
						}), team.captainInbox.slice(-2).map((message, index) => (0, react_jsx_runtime.jsxs)("div", {
							className: ActivityPanel_module_css_default.inboxRow,
							children: [(0, react_jsx_runtime.jsxs)("span", {
								className: ActivityPanel_module_css_default.inboxRoute,
								children: [
									message.from,
									(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {}),
									"队长"
								]
							}), (0, react_jsx_runtime.jsx)("span", {
								className: ActivityPanel_module_css_default.inboxContent,
								title: message.content,
								children: message.content
							})]
						}, index))]
					})
				]
			});
		}
		/** The top-right activity floater. Teams follow the current session: live
		* snapshots and historic card summaries are only shown while their captain
		* session is the one currently open. */
		function ActivityPanel({ sessionsList, openSession }) {
			const navigateToSession = (id) => {
				setOpen(false);
				setWasActive(false);
				openSession(id);
			};
			const [teams, setTeams] = (0, react.useState)([]);
			const [open, setOpen] = (0, react.useState)(false);
			const [autoOpened, setAutoOpened] = (0, react.useState)(false);
			const [wasActive, setWasActive] = (0, react.useState)(false);
			const [historic, setHistoric] = (0, react.useState)(/* @__PURE__ */ new Map());
			const [archived, setArchived] = (0, react.useState)(/* @__PURE__ */ new Map());
			const current = (0, react.useSyncExternalStore)(sessionsList.subscribe, sessionsList.getSnapshot).current;
			const currentRef = (0, react.useRef)(current);
			(0, react.useEffect)(() => {
				currentRef.current = current;
			}, [current]);
			const mountedAtRef = (0, react.useRef)(performance.now());
			(0, react.useEffect)(() => {
				const root = document.documentElement;
				if (open) root.setAttribute(PANEL_OPEN_ATTRIBUTE, "");
				else root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
				return () => {
					root.removeAttribute(PANEL_OPEN_ATTRIBUTE);
				};
			}, [open]);
			(0, react.useEffect)(() => {
				let cancelled = false;
				let inFlight = false;
				const tick = async () => {
					if (inFlight || cancelled) return;
					inFlight = true;
					try {
						const response = await fetch(STATE_URL, { cache: "no-store" });
						if (!response.ok) return;
						const body = await response.json();
						if (!cancelled && Array.isArray(body.teams)) setTeams(body.teams);
					} catch {} finally {
						inFlight = false;
					}
				};
				tick();
				const timer = setInterval(() => {
					tick();
				}, POLL_MS);
				return () => {
					cancelled = true;
					clearInterval(timer);
				};
			}, []);
			(0, react.useEffect)(() => {
				let cancelled = false;
				const onOpenPanel = (event) => {
					setOpen(true);
					const detail = event.detail;
					if (detail?.teamId !== void 0) {
						const owner = detail.captainSessionId !== "" ? detail.captainSessionId : currentRef.current ?? "";
						const teamKey = `${owner}:${detail.teamId}`;
						setHistoric((previous) => {
							const next = new Map(previous);
							next.set(teamKey, {
								data: detail,
								owner
							});
							return next;
						});
						fetch(`${STATE_URL}?archived=1`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((body) => {
							if (cancelled || body === null || !Array.isArray(body.teams)) return;
							const found = body.teams.find((team) => team.teamId === detail?.teamId && team.captainSessionId === owner);
							if (found !== void 0) setArchived((previous) => {
								const next = new Map(previous);
								next.set(teamKey, found);
								return next;
							});
						}).catch(() => {});
					}
				};
				window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				return () => {
					cancelled = true;
					window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel);
				};
			}, []);
			const visibleTeams = (0, react.useMemo)(() => current === void 0 ? [] : teams.filter((team) => team.captainSessionId === current), [teams, current]);
			const visibleHistoric = (0, react.useMemo)(() => current === void 0 ? [] : [...historic.values()].filter(({ data, owner }) => owner === current && !teams.some((live) => live.captainSessionId === current && live.teamId === data.teamId)), [
				historic,
				current,
				teams
			]);
			const visibleCount = visibleTeams.length + visibleHistoric.length;
			(0, react.useEffect)(() => {
				if (visibleCount > 0) {
					setWasActive(true);
					const settled = performance.now() - mountedAtRef.current >= AUTO_OPEN_SETTLE_MS;
					if (!autoOpened && settled) {
						setOpen(true);
						setAutoOpened(true);
					}
					return;
				}
				if (!wasActive) return;
				const timer = setTimeout(() => {
					setOpen(false);
					setWasActive(false);
					setAutoOpened(false);
				}, AUTOCLOSE_GRACE_MS);
				return () => {
					clearTimeout(timer);
				};
			}, [
				visibleCount,
				autoOpened,
				wasActive
			]);
			const busy = (0, react.useMemo)(() => visibleTeams.some((team) => team.members.some((member) => member.activity === "working")), [visibleTeams]);
			if (!(visibleCount > 0) && !open) return null;
			return (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [!open && (0, react_jsx_runtime.jsx)(CollapsedBadge, {
				count: visibleCount,
				busy,
				onClick: () => {
					setOpen(true);
				}
			}), open && (0, react_jsx_runtime.jsxs)("aside", {
				className: ActivityPanel_module_css_default.panel,
				"data-agent-teams-activity": true,
				children: [(0, react_jsx_runtime.jsxs)("header", {
					className: ActivityPanel_module_css_default.panelHead,
					children: [(0, react_jsx_runtime.jsxs)("span", {
						className: ActivityPanel_module_css_default.panelTitle,
						children: ["AgentTeams 活动", (0, react_jsx_runtime.jsx)("span", {
							className: ActivityPanel_module_css_default.panelDot,
							"data-busy": busy,
							"aria-hidden": true
						})]
					}), (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: ActivityPanel_module_css_default.closeButton,
						onClick: () => {
							setOpen(false);
						},
						"aria-label": "关闭",
						children: (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {})
					})]
				}), (0, react_jsx_runtime.jsx)("div", {
					className: ActivityPanel_module_css_default.teams,
					children: visibleCount === 0 ? (0, react_jsx_runtime.jsx)("span", {
						className: ActivityPanel_module_css_default.emptyHint,
						children: "暂无团队活动"
					}) : (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [visibleTeams.map((team) => (0, react_jsx_runtime.jsx)(TeamSection, {
						team,
						onNavigate: navigateToSession
					}, team.teamId)), visibleHistoric.map(({ data: team, owner }) => {
						const teamKey = `${owner}:${team.teamId}`;
						const archivedTeam = archived.get(teamKey);
						if (archivedTeam !== void 0) return (0, react_jsx_runtime.jsx)("div", {
							"data-team-id": team.teamId,
							"data-historic": true,
							className: ActivityPanel_module_css_default.archivedWrap,
							children: (0, react_jsx_runtime.jsx)(TeamSection, {
								team: archivedTeam,
								onNavigate: navigateToSession
							})
						}, teamKey);
						return (0, react_jsx_runtime.jsxs)("section", {
							className: ActivityPanel_module_css_default.team,
							"data-team-id": team.teamId,
							"data-historic": true,
							children: [(0, react_jsx_runtime.jsxs)("header", {
								className: ActivityPanel_module_css_default.teamHead,
								children: [(0, react_jsx_runtime.jsxs)("span", {
									className: ActivityPanel_module_css_default.teamName,
									title: team.teamName,
									children: [
										(0, react_jsx_runtime.jsx)("img", {
											className: ActivityPanel_module_css_default.leadAvatar,
											src: LEAD_ART,
											alt: "",
											"aria-hidden": true
										}),
										" ",
										team.teamName
									]
								}), (0, react_jsx_runtime.jsx)("span", {
									className: ActivityPanel_module_css_default.historicPill,
									children: "已结束"
								})]
							}), (0, react_jsx_runtime.jsx)("div", {
								className: ActivityPanel_module_css_default.members,
								children: team.members.map((member) => (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: ActivityPanel_module_css_default.memberRow,
									"data-activity": "idle",
									onClick: () => {
										if (member.id !== "") navigateToSession(member.id);
									},
									children: [(0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.memberAvatar,
										children: memberArtUrl(member.name, member.role) !== null ? (0, react_jsx_runtime.jsx)("img", {
											className: ActivityPanel_module_css_default.memberArt,
											src: memberArtUrl(member.name, member.role) ?? "",
											alt: "",
											"aria-hidden": true
										}) : (0, react_jsx_runtime.jsx)("span", {
											className: ActivityPanel_module_css_default.memberInitial,
											style: { background: accentOf(member.id) },
											children: memberInitial(member.name)
										})
									}), (0, react_jsx_runtime.jsx)("span", {
										className: ActivityPanel_module_css_default.memberInfo,
										children: (0, react_jsx_runtime.jsxs)("span", {
											className: ActivityPanel_module_css_default.memberLine,
											children: [(0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberName,
												children: member.name
											}), member.role !== "" && (0, react_jsx_runtime.jsx)("span", {
												className: ActivityPanel_module_css_default.memberRole,
												children: member.role
											})]
										})
									})]
								}, member.id))
							})]
						}, teamKey);
					})] })
				})]
			})] });
		}
		//#endregion
		//#region lib/client/agent-teams-card-definition.js
		/**
		* AgentTeams conversation card: a lightweight in-conversation summary shown
		* when a team is created — the captain's name, the member roster with whale
		* avatars, and an entry point that re-activates the top-right activity
		* panel (useful after the floater was closed, or when re-opening an old
		* session for review).
		*
		* The fold replays the durable `agent-teams/*` session events (the same
		* event family the activity panel's server snapshots are derived from), so
		* the card survives restarts and appears in any session whose log carries
		* the team's events.
		* @module dsh-agent-teams/client/card
		*/
		function updateMemberAdded(state, data) {
			if (state.members.some((member) => member.id === data.memberId)) return state;
			return {
				...state,
				members: [...state.members, {
					id: data.memberId,
					name: data.name,
					...data.role !== void 0 ? { role: data.role } : {}
				}]
			};
		}
		/** Durable `agent-teams/*` events folded into one keyed Chat node. */
		const agentTeamsCardDefinition = {
			kind: "agent-teams",
			target: "chat",
			match: (event) => {
				if (event.type === "agent-teams/team-created") return {
					id: String(event.data.teamId),
					role: "start"
				};
				if (event.type === "agent-teams/member-added" || event.type === "agent-teams/member-removed") return {
					id: String(event.data.teamId),
					role: "update"
				};
				return null;
			},
			start: (_context, match) => {
				if (match.event.type !== "agent-teams/team-created") throw new Error("agent-teams card start requires agent-teams/team-created");
				return {
					teamId: match.event.data.teamId,
					captainSessionId: match.event.data.captainSessionId ?? "",
					name: match.event.data.name,
					members: []
				};
			},
			update: (context, match) => {
				if (match.event.type === "agent-teams/member-added") return updateMemberAdded(context.state, match.event.data);
				if (match.event.type === "agent-teams/member-removed") {
					const removedMemberId = match.event.data.memberId;
					return {
						...context.state,
						members: context.state.members.map((member) => member.id === removedMemberId ? {
							...member,
							removed: true
						} : member)
					};
				}
				return context.state;
			},
			buildViewNode: (context) => {
				if (context.start === void 0) return null;
				const state = context.state;
				return {
					key: context.key,
					kind: "agent-teams",
					id: context.id,
					target: "chat",
					anchorSeq: context.start.event.seq,
					location: context.start.location,
					visibility: "visible",
					data: {
						teamId: state.teamId,
						captainSessionId: state.captainSessionId,
						teamName: state.name,
						members: state.members.filter((member) => member.removed !== true).map((member) => ({
							id: member.id,
							name: member.name,
							role: member.role ?? ""
						}))
					}
				};
			}
		};
		//#endregion
		//#region lib/client/index.js
		/** Required services: conversation nodes, slots, and sessions navigation. */
		const inject = [
			"conversationEvents",
			"slots",
			"sessions"
		];
		/**
		* Mount the floater through a body portal (the web shell has no top-right
		* slot) and register the in-conversation team card, whose "activity panel"
		* button re-activates the floater via a window event — the recovery path
		* for a closed floater or a re-opened session.
		*/
		function apply(ctx) {
			const host = document.createElement("div");
			host.dataset.agentTeamsHost = "";
			document.body.appendChild(host);
			const root = (0, react_dom_client.createRoot)(host);
			root.render((0, react_jsx_runtime.jsx)(ActivityPanel, {
				sessionsList: ctx.sessions.list,
				openSession: (id) => {
					ctx.sessions.open(id);
				}
			}));
			ctx.effect(() => () => {
				root.unmount();
				host.remove();
			}, "agent-teams: activity panel");
			ctx.conversationEvents.register(agentTeamsCardDefinition);
			ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
				name: "conversation.chat.node",
				key: "agent-teams",
				inject: () => ({ openSession: (id) => {
					ctx.sessions.open(id);
				} })
			}, AgentTeamsCard));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map