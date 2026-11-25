import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** Plugin-owned icons avoid depending on the host's generated design-export names. */
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' };
export function IconBranchOutline16() {
    return _jsxs("svg", { width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true", ...stroke, children: [_jsx("circle", { cx: "4", cy: "3", r: "1.5" }), _jsx("circle", { cx: "12", cy: "4", r: "1.5" }), _jsx("circle", { cx: "4", cy: "13", r: "1.5" }), _jsx("path", { d: "M4 4.5v7M4 9h3a5 5 0 0 0 5-3.5" })] });
}
export function IconChevronDownOutline14() {
    return _jsx("svg", { width: "14", height: "14", viewBox: "0 0 14 14", "aria-hidden": "true", ...stroke, children: _jsx("path", { d: "m3 5 4 4 4-4" }) });
}
export function IconPanelLeftOutline16() {
    return _jsxs("svg", { width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true", ...stroke, children: [_jsx("rect", { x: "2", y: "2.5", width: "12", height: "11", rx: "2" }), _jsx("path", { d: "M6 2.5v11" })] });
}
export function IconStopFill16() {
    return _jsx("svg", { width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true", children: _jsx("rect", { x: "4", y: "4", width: "8", height: "8", rx: "1", fill: "currentColor" }) });
}
export function IconWarningOutline16() {
    return _jsxs("svg", { width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true", ...stroke, children: [_jsx("path", { d: "m7 2-5.5 10a1 1 0 0 0 1 1.5h11a1 1 0 0 0 1-1.5L9 2a1.1 1.1 0 0 0-2 0Z" }), _jsx("path", { d: "M8 6v3m0 2v.1" })] });
}
/** Global console entry: three teammates joined around a shared lead. */
export function IconTeamsConsole({ size = 16, active = false }) {
    return _jsxs("svg", { width: size, height: size, viewBox: "0 0 16 16", "aria-hidden": "true", ...stroke, "data-active": active || undefined, children: [_jsx("circle", { cx: "4.5", cy: "4", r: "1.5" }), _jsx("circle", { cx: "11.5", cy: "4", r: "1.5" }), _jsx("circle", { cx: "8", cy: "11.5", r: "1.5" }), _jsx("path", { d: "M4.5 5.5v1.2A2.3 2.3 0 0 0 6.8 9h.5M11.5 5.5v1.2A2.3 2.3 0 0 1 9.2 9h-.5" })] });
}
