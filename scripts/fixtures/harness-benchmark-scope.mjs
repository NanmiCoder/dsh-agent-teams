/** Test-harness constraints for the shared /tmp cwd; not a general shell sandbox. */
export function assertBenchmarkShellScope(command, workspace) {
  if (typeof command !== 'string') throw Error('Benchmark shell command must be text');
  if (/\b(?:pkill|killall)\b/.test(command)) {
    throw Error('Only stop your own tracked process ID or call service.close(). Do not use pkill or killall.');
  }
  // `cd project && (...) &` backgrounds the entire list: later cleanup still
  // runs in /tmp. Tests should start/fetch/close the server in one Node process.
  if (/(?<![&>])&(?!&)/.test(command)) {
    throw Error('Do not background shell commands in this benchmark. Start the server, fetch it and await close() in one Node process.');
  }
  const escaped = workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp('^\\s*cd\\s+(?:--\\s+)?(?:' + escaped + '|"' + escaped + '"|\'' + escaped + '\')(?:\\s*(?:&&|;|\\n)|\\s*$)').test(command)) {
    throw Error('Start every shell command with cd ' + workspace + ' && ... so relative paths resolve inside this project.');
  }
}
