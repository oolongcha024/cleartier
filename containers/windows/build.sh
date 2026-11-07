#!/usr/bin/env bash
set -euo pipefail

build_mode="${1:-all}"
case "$build_mode" in
  exe|nsis|all) ;;
  *) printf 'Unknown build mode: %s\n' "$build_mode" >&2; exit 2 ;;
esac

build_target=x86_64-pc-windows-msvc
release_dir="/workspace/src-tauri/target/$build_target/release"
artifact_root=/workspace/artifacts/windows-x64
mkdir -p "$CARGO_HOME" "$XWIN_CACHE_DIR" "$XDG_CACHE_HOME" "$XDG_DATA_HOME" "$XDG_STATE_HOME"

pnpm install --frozen-lockfile --store-dir /cache/pnpm-store

build_args=(tauri build --ci --runner cargo-xwin --target "$build_target")
if [[ "$build_mode" == exe ]]; then
  build_args+=(--no-bundle)
else
  build_args+=(--bundles nsis)
  # An old installer must not be mistaken for an output of this build.
  rm -f "$release_dir"/bundle/nsis/*-setup.exe
fi
pnpm "${build_args[@]}" -- --locked

mkdir -p "$artifact_root"
artifact_files=()
if [[ "$build_mode" == exe || "$build_mode" == all ]]; then
  mkdir -p "$artifact_root/exe"
  cp "$release_dir/cleartier.exe" "$artifact_root/exe/cleartier.exe"
  artifact_files+=(exe/cleartier.exe)
fi
if [[ "$build_mode" == nsis || "$build_mode" == all ]]; then
  shopt -s nullglob
  installers=("$release_dir"/bundle/nsis/*-setup.exe)
  if [[ ${#installers[@]} -ne 1 ]]; then
    printf 'Expected one new NSIS installer, found %s.\n' "${#installers[@]}" >&2
    exit 1
  fi
  mkdir -p "$artifact_root/nsis"
  rm -f "$artifact_root"/nsis/*-setup.exe
  cp "${installers[0]}" "$artifact_root/nsis/"
  artifact_files+=("nsis/$(basename "${installers[0]}")")
fi

node --input-type=module - "$build_mode" "${artifact_files[@]}" <<'JS'
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [mode, ...paths] = process.argv.slice(2);
const root = '/workspace/artifacts/windows-x64';
const config = JSON.parse(readFileSync('/workspace/src-tauri/tauri.conf.json', 'utf8'));
const manifest = {
  product: config.productName,
  version: config.version,
  target: 'x86_64-pc-windows-msvc',
  mode,
  builtAt: new Date().toISOString(),
  builderImage: process.env.CLEARTIER_BUILDER_IMAGE,
  signed: false,
  files: paths.map(path => ({
    path,
    size: statSync(join(root, path)).size,
    sha256: createHash('sha256').update(readFileSync(join(root, path))).digest('hex'),
  })),
};
writeFileSync(join(root, 'build-info.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('\nWindows build complete:');
for (const file of manifest.files) console.log(`  artifacts/windows-x64/${file.path} (${file.size} bytes)`);
JS
