/**
 * Local contract for the host's global sidebar panel list.
 *
 * `@deepseek-ai/dsh-client-ui-sidebar` is provided by the Harness browser
 * bundle rather than this package's dependency graph. Declaring the slot here
 * keeps the client compile-time typed without adding a runtime or peer import;
 * the host's own declaration is structurally identical.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.panellist': {
      kind: 'list'
      scope: 'root'
      owner: { size: number; active: boolean }
    }
  }
}

export {}
