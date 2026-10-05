/**
 * Start the normal frontend development command with the Morning Brief's
 * presentation-only connected-state fixture enabled for this child process.
 *
 * Compatibility entrypoint. The managed launcher owns locking, port checks,
 * build-directory isolation and cleanup for every frontend mode.
 */
import { main } from './launchmind-dev.mjs';

main(['--mode=demo']).catch(error => {
  console.error(`\n[morning-brief-demo] ${error.message}\n`);
  process.exitCode = 1;
});
