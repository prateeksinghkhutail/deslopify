/**
 * deslopify OpenCode Plugin
 * 
 * This plugin integrates with OpenCode to notify the deslopify daemon
 * whenever tool calls complete or messages are received, enabling
 * automatic context monitoring and compaction.
 */

import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';

const SOCKET_PATH = path.join(os.homedir(), '.deslopify', 'daemon.sock');

/**
 * Send an event to the deslopify daemon via unix socket
 */
function notifyDaemon(event, sessionId) {
  try {
    const client = net.createConnection(SOCKET_PATH);
    client.on('connect', () => {
      client.write(JSON.stringify({ 
        event, 
        cli: 'opencode', 
        sessionId: sessionId || 'unknown' 
      }));
      client.end();
    });
    client.on('error', () => {
      // Daemon not running - silently ignore
    });
  } catch {
    // Ignore connection errors
  }
}

/**
 * Called when a message is received in the conversation
 */
export function onMessage(message) {
  if (message && message.role === 'assistant') {
    notifyDaemon('message_complete', message.sessionId || message.id);
  }
}

/**
 * Called when a tool execution completes
 */
export function onToolComplete(tool) {
  notifyDaemon('tool_complete', tool.sessionId || tool.id);
}

/**
 * Called when the session starts
 */
export function onSessionStart(session) {
  notifyDaemon('session_start', session.id);
}

/**
 * Called when compact finishes
 */
export function onCompactComplete(session) {
  notifyDaemon('compact_complete', session.id);
}

/**
 * Plugin metadata
 */
export const metadata = {
  name: 'deslopify',
  version: '1.0.0',
  description: 'Automatic context bloat management',
  events: ['onMessage', 'onToolComplete', 'onSessionStart', 'onCompactComplete']
};
