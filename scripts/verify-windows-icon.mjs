import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Check the actual Windows application resource, not a PNG embedded elsewhere
// in the executable. Keep this independent of host-specific inspection tools.
export function verifyWindowsIcon(executable, ico) {
  const fail = (message) => { throw new Error(`Windows icon verification failed: ${message}`); };
  const slice = (buffer, offset, size) => {
    if (offset < 0 || size < 0 || offset + size > buffer.length) fail('truncated resource');
    return buffer.subarray(offset, offset + size);
  };
  const u16 = (buffer, offset) => slice(buffer, offset, 2).readUInt16LE();
  const u32 = (buffer, offset) => slice(buffer, offset, 4).readUInt32LE();
  if (executable.toString('ascii', 0, 2) !== 'MZ') fail('missing DOS header');
  const pe = u32(executable, 0x3c);
  if (!slice(executable, pe, 4).equals(Buffer.from('PE\0\0'))) fail('missing PE header');
  const optional = pe + 24;
  const magic = u16(executable, optional);
  if (magic !== 0x20b && magic !== 0x10b) fail('unsupported PE format');
  const sectionTable = optional + u16(executable, pe + 20);
  const sections = Array.from({ length: u16(executable, pe + 6) }, (_, index) => {
    const start = sectionTable + index * 40;
    return {
      address: u32(executable, start + 12),
      size: u32(executable, start + 16),
      offset: u32(executable, start + 20),
    };
  });
  const offsetOf = (address) => {
    const section = sections.find((item) => address >= item.address && address < item.address + item.size);
    if (!section) fail('unmapped resource address');
    return section.offset + address - section.address;
  };
  const directoryTable = optional + (magic === 0x20b ? 112 : 96);
  const root = offsetOf(u32(executable, directoryTable + 16));
  const entries = (relative) => {
    const start = root + relative;
    const count = u16(executable, start + 12) + u16(executable, start + 14);
    return Array.from({ length: count }, (_, index) => ({
      id: u32(executable, start + 16 + index * 8),
      target: u32(executable, start + 20 + index * 8),
    }));
  };
  const resources = (type) => {
    const node = entries(0).find((entry) => entry.id === type);
    if (!node || !(node.target & 0x80000000)) fail(`missing resource type ${type}`);
    const result = [];
    const walk = (relative, path = []) => {
      if (path.length > 2) fail('unexpected resource nesting');
      for (const entry of entries(relative)) {
        if (entry.target & 0x80000000) walk(entry.target & 0x7fffffff, [...path, entry.id]);
        else {
          const leaf = root + entry.target;
          result.push({
            id: path[0], language: entry.id,
            data: slice(executable, offsetOf(u32(executable, leaf)), u32(executable, leaf + 4)),
          });
        }
      }
    };
    walk(node.target & 0x7fffffff);
    return result;
  };

  if (u16(ico, 0) !== 0 || u16(ico, 2) !== 1) fail('invalid ICO header');
  const count = u16(ico, 4);
  if (!count) fail('ICO has no images');
  const expected = Array.from({ length: count }, (_, index) => {
    const start = 6 + index * 16;
    return slice(ico, u32(ico, start + 12), u32(ico, start + 8));
  });
  const images = resources(3);
  // Tauri's application/default-window icon uses the Windows IDI_APPLICATION ID.
  const groups = resources(14).filter((group) => group.id === 32512);
  if (!groups.length) fail('missing application icon group');
  for (const group of groups) {
    if (u16(group.data, 0) !== 0 || u16(group.data, 2) !== 1 || u16(group.data, 4) !== count) fail('icon image count differs');
    const remaining = [...expected];
    for (let index = 0; index < count; index++) {
      const entry = 6 + index * 14;
      const id = u16(group.data, entry + 12);
      const image = images.find((item) => item.id === id && item.language === group.language);
      if (!image || image.data.length !== u32(group.data, entry + 8)) fail('missing icon image');
      const match = remaining.findIndex((data) => data.equals(image.data));
      if (match === -1) fail('embedded icon differs from the current ICO; rebuild Windows resources');
      remaining.splice(match, 1);
    }
  }
  return { images: count, groups: groups.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [executablePath, iconPath, ...extra] = process.argv.slice(2);
    if (!executablePath || !iconPath || extra.length) throw new Error('Usage: node scripts/verify-windows-icon.mjs <exe> <ico>');
    const result = verifyWindowsIcon(readFileSync(executablePath), readFileSync(iconPath));
    console.log(`Verified Windows application icon: ${result.images} images match ${iconPath}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
