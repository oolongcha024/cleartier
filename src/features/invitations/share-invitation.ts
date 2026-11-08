import { configsEqual } from '../networks/configuration.ts';
import type { Network, NetworkConfig } from '../networks/model.ts';
import {
  encodeInvitation,
  InvitationError,
  invitationSource,
  type JoinParameters,
} from './invitation.ts';

// One action owns source selection, async native extraction, stale-result checks
// and clipboard outcome. Both desktop and preview cross this same Interface.
export async function shareInvitation(
  read: () => Network | undefined,
  adapters: {
    parameters: (id: string, config: NetworkConfig) => Promise<JoinParameters>;
    copy: (text: string) => Promise<boolean>;
  },
): Promise<{ copied: boolean; text: string; pending: boolean }> {
  const network = read();
  if (!network) throw new InvitationError('unavailable');
  const source = structuredClone(invitationSource(network));
  if (!source.config.servers.length) throw new InvitationError('missingServers');
  const parameters = await adapters.parameters(network.id, structuredClone(source.config));
  const latest = read();
  if (!latest) throw new InvitationError('changed');
  const current = invitationSource(latest);
  if (!configsEqual(source.config, current.config)) throw new InvitationError('changed');
  const text = encodeInvitation({ ...parameters, displayName: latest.alias });
  let copied = false;
  try {
    copied = await adapters.copy(text);
  } catch {
    /* Manual copy is the only fallback. */
  }
  return { copied, text, pending: current.pending };
}
