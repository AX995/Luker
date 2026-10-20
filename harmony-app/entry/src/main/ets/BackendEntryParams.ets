/**
 * The key=value lines the native node launcher parses.
 *
 * Kept apart from the launcher so the parameter contract can be checked
 * without loading the native node library. The launcher passes every key it
 * does not recognise straight into the node process environment, which is how
 * the capture client learns which process hosts the WebView.
 */
export function assembleEntryParams(dataDir: string, scriptPath: string, port: number, hostPid: number): string {
  return [
    `dataDir=${dataDir}`,
    `script=${scriptPath}`,
    `port=${port}`,
    `LUKER_HOST_PID=${hostPid}`
  ].join('\n');
}
