import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './client';
import { InvitationError, type JoinParameters } from '../features/invitations/invitation';
import type { NetworkConfig } from '../features/networks/model';

export function readJoinParameters(id: string, config: NetworkConfig): Promise<JoinParameters> {
  if (isDesktop()) return invoke<JoinParameters>('invitation_parameters', { id, config });
  // Browser demo configurations have no native TOML base. Never attempt to
  // discard unparsed imported settings or claim a native validation succeeded.
  if (config.officialToml !== undefined) return Promise.reject(new InvitationError('unsupportedConfiguration'));
  return Promise.resolve({ name: config.name, secret: config.secret, servers: [...config.servers] });
}
