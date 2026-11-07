import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyWindowsIcon } from '../scripts/verify-windows-icon.mjs';

// A minimal PE resource tree follows the same type/name/language structure and
// application group ID as Tauri's real Windows output. Image bytes stay opaque.
function fixture({ image = 'current-icon', expected = 'current-icon', resourceId = 1, magic = 0x20b } = {}) {
  const executable = Buffer.alloc(0x600);
  const u16 = (offset, value) => executable.writeUInt16LE(value, offset);
  const u32 = (offset, value) => executable.writeUInt32LE(value, offset);
  executable.write('MZ');
  u32(0x3c, 0x80);
  executable.write('PE\0\0', 0x80);
  u16(0x86, 1);
  const optionalSize = magic === 0x20b ? 240 : 224;
  u16(0x94, optionalSize);
  u16(0x98, magic);
  u32(0x98 + (magic === 0x20b ? 112 : 96) + 16, 0x1000);
  const section = 0x98 + optionalSize;
  u32(section + 12, 0x1000);
  u32(section + 16, 0x400);
  u32(section + 20, 0x200);
  const directory = (relative, entries) => {
    u16(0x200 + relative + 14, entries.length);
    entries.forEach(([id, target], index) => {
      u32(0x200 + relative + 16 + index * 8, id);
      u32(0x200 + relative + 20 + index * 8, target);
    });
  };
  directory(0, [[3, 0x80000030], [14, 0x80000050]]);
  directory(0x30, [[1, 0x80000070]]);
  directory(0x50, [[32512, 0x80000090]]);
  directory(0x70, [[1033, 0xb0]]);
  directory(0x90, [[1033, 0xc0]]);
  const payload = Buffer.from(image);
  u32(0x2b0, 0x1100);
  u32(0x2b4, payload.length);
  payload.copy(executable, 0x300);
  u32(0x2c0, 0x1180);
  u32(0x2c4, 20);
  u16(0x382, 1);
  u16(0x384, 1);
  u32(0x38e, payload.length);
  u16(0x392, resourceId);
  const expectedImage = Buffer.from(expected);
  const ico = Buffer.alloc(22 + expectedImage.length);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico.writeUInt32LE(expectedImage.length, 14);
  ico.writeUInt32LE(22, 18);
  expectedImage.copy(ico, 22);
  return { executable, ico };
}

test('verifies the application resource in both PE32 and PE32+ executables', () => {
  for (const magic of [0x10b, 0x20b]) {
    const { executable, ico } = fixture({ magic });
    assert.deepEqual(verifyWindowsIcon(executable, ico), { images: 1, groups: 1 });
  }
});

test('rejects stale application icons even if the new image exists elsewhere in the executable', () => {
  const { executable, ico } = fixture({ image: 'old-default', expected: 'new-brand' });
  executable.write('new-brand', 0x500);
  assert.throws(() => verifyWindowsIcon(executable, ico), /embedded icon differs/);
});

test('rejects a group referencing a missing image and malformed or empty ICO input', () => {
  const { executable, ico } = fixture({ resourceId: 2 });
  assert.throws(() => verifyWindowsIcon(executable, ico), /missing icon image/);
  assert.throws(() => verifyWindowsIcon(executable, ico.subarray(0, 12)), /truncated resource/);
  const empty = Buffer.alloc(6);
  empty.writeUInt16LE(1, 2);
  assert.throws(() => verifyWindowsIcon(executable, empty), /ICO has no images/);
});

test('rejects truncated or non-Windows executables', () => {
  const { executable, ico } = fixture();
  assert.throws(() => verifyWindowsIcon(Buffer.from('not PE'), ico), /missing DOS header/);
  assert.throws(() => verifyWindowsIcon(executable.subarray(0, 0x300), ico), /truncated resource/);
});
