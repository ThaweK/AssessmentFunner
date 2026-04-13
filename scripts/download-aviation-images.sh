#!/usr/bin/env bash
set -u

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${ROOT_DIR}/assets/img"
mkdir -p "${TARGET_DIR}"

# Curated external URLs (internet photos, no AI generation).
declare -a SOURCES=(
  "aviation-wing-1.jpg|https://images.pexels.com/photos/62623/wing-plane-flying-airplane-62623.jpeg"
  "aviation-apron-1.jpg|https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg"
  "aviation-cockpit-1.jpg|https://images.pexels.com/photos/912050/pexels-photo-912050.jpeg"
)

downloaded=0
retained=0
missing=0

for item in "${SOURCES[@]}"; do
  name="${item%%|*}"
  url="${item#*|}"
  out="${TARGET_DIR}/${name}"
  tmp="${out}.tmp"
  echo "Downloading ${name}..."
  if curl -f -s -o "${tmp}" "${url}"; then
    mv "${tmp}" "${out}"
    downloaded=$((downloaded + 1))
  else
    rm -f "${tmp}"
    if [[ -s "${out}" ]]; then
      echo "Warning: could not refresh ${name}. Keeping existing local file."
      retained=$((retained + 1))
    else
      echo "Warning: could not download ${name} and no local fallback exists."
      missing=$((missing + 1))
    fi
  fi
done

echo "Done. Downloaded: ${downloaded}, retained: ${retained}, missing: ${missing}."
echo "Images directory: ${TARGET_DIR}"

if command -v node >/dev/null 2>&1; then
  node "${ROOT_DIR}/scripts/sync-image-manifest.mjs" || echo "Warning: manifest sync failed."
fi
