import { configsEqual, type NetworkDraft } from '../networks/configuration.ts';
import { sessionConfig, type Network, type NetworkConfig } from '../networks/model.ts';

export interface JoinParameters { name: string; secret: string; servers: string[] }
export interface Invitation extends JoinParameters { displayName?: string }
export type InvitationErrorCode = 'invalid' | 'unsupportedVersion' | 'unsupportedFields' | 'tooLarge' | 'multiple'
  | 'missingServers' | 'invalidServer' | 'unavailable' | 'unsupportedConfiguration' | 'changed';
export class InvitationError extends Error {
  readonly code: InvitationErrorCode;
  constructor(code: InvitationErrorCode) { super(code); this.code = code; }
}
export const maxInvitationInput = 65536;
const maxCode = 32768;
const prefix = 'cleartier:v1:';
const protocols = new Set(['tcp:', 'udp:', 'wg:', 'quic:', 'ws:', 'wss:', 'http:', 'https:', 'txt:', 'srv:']);
const fail = (code: InvitationErrorCode): never => { throw new InvitationError(code); };

function validate(value: unknown): Invitation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('invalid');
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some(key => !['name', 'secret', 'servers', 'displayName'].includes(key))) return fail('unsupportedFields');
  if (typeof fields.name !== 'string' || !fields.name.trim() || fields.name.length > 512
    || typeof fields.secret !== 'string' || fields.secret.length > 4096
    || (fields.displayName !== undefined && (typeof fields.displayName !== 'string' || fields.displayName.length > 256 || /[\u0000-\u001f\u007f]/.test(fields.displayName)))) return fail('invalid');
  if (!Array.isArray(fields.servers)) return fail('invalid');
  if (!fields.servers.length) return fail('missingServers');
  if (fields.servers.length > 16) return fail('tooLarge');
  for (const server of fields.servers) {
    if (typeof server !== 'string' || server.length > 2048 || /\s/.test(server) || !/^[a-z][a-z\d+.-]*:\/\//i.test(server)) return fail('invalidServer');
    let url: URL;
    try { url = new URL(server); } catch { return fail('invalidServer'); }
    if (!protocols.has(url.protocol) || !url.hostname || url.port === '0'
      || /^(?:localhost\.?|127(?:\..*)?|0\.0\.0\.0|\[::\]|\[::1\])$/i.test(url.hostname)) return fail('invalidServer');
  }
  return { name: fields.name, secret: fields.secret, servers: [...new Set(fields.servers as string[])],
    ...(fields.displayName === undefined ? {} : { displayName: fields.displayName as string }) };
}
function base64url(bytes: Uint8Array): string {
  // Bounded input makes this safe without spreading an entire payload onto the stack.
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function encodeInvitation(value: Invitation): string {
  const details = validate(value);
  const result = prefix + base64url(new TextEncoder().encode(JSON.stringify(details)));
  if (result.length > maxCode) return fail('tooLarge');
  return result;
}

export function decodeInvitation(text: string): Invitation {
  if (text.length > maxInvitationInput) return fail('tooLarge');
  // Permit surrounding chat prose and punctuation. Never choose an arbitrary
  // network when a pasted conversation contains multiple invitations.
  const tokens = text.match(/cleartier:v[^\s<>"'`，。；！？、（）【】「」『』“”‘’()[\]{},;!?]+/gi) ?? [];
  if (tokens.length > 1) return fail('multiple');
  const rawToken = tokens[0];
  if (!rawToken) return fail('invalid');
  const token = rawToken.replace(/[.:]+$/, '');
  if (token.length > maxCode) return fail('tooLarge');
  const match = /^cleartier:v(\d+):(.+)$/i.exec(token);
  if (!match) return fail('invalid');
  if (match[1] !== '1') return fail('unsupportedVersion');
  const payload = match[2];
  if (!/^[a-z\d_-]+$/i.test(payload) || payload.length % 4 === 1) return fail('invalid');
  let value: unknown;
  try {
    const binary = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    if (base64url(bytes) !== payload) return fail('invalid');
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { return fail('invalid'); }
  return validate(value);
}

export interface InvitationSource { config: NetworkConfig; pending: boolean }
export function invitationSource(network: Network): InvitationSource {
  if (network.coreState === 'running') {
    if (!network.runningConfig) return fail('unavailable');
    return { config: network.runningConfig, pending: !configsEqual(network.savedConfig, network.runningConfig) };
  }
  if ((network.coreState === 'stopped' || network.coreState === 'failed') && sessionConfig(network) === null) {
    return { config: network.savedConfig, pending: false };
  }
  return fail('unavailable');
}

export function fillInvitation(draft: NetworkDraft, details: Invitation, previousSuggestion?: string): NetworkDraft {
  const suggested = details.displayName?.trim() || details.name;
  return { ...draft, name: details.name, secret: details.secret, servers: details.servers.join('\n'),
    alias: !draft.alias.trim() || draft.alias === previousSuggestion ? suggested : draft.alias };
}
export function invitationError(error: unknown): InvitationErrorCode {
  return error instanceof InvitationError ? error.code : 'unsupportedConfiguration';
}
