#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 [tag ...]"
  echo "Build and publish the browser image under each tag. Defaults to latest."
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if (( $# == 0 )); then
  image_tags=(latest)
else
  image_tags=("$@")
fi
image_repository="${REMOTE_AGENT_BROWSER_IMAGE_REPOSITORY:-vcr.vercel.com/vercel-labs/remote-agent-browser/remote-agent-browser}"
project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

for image_tag in "${image_tags[@]}"; do
  if [[ ! "$image_tag" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "Invalid Docker image tag: $image_tag" >&2
    exit 2
  fi
done

for command_name in vercel docker; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command not found: $command_name" >&2
    exit 1
  fi
done

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker Buildx is required" >&2
  exit 1
fi

credentials_file="$(mktemp "${TMPDIR:-/tmp}/remote-agent-browser-env.XXXXXX")"
trap 'rm -f "$credentials_file"' EXIT

(
  cd "$project_dir"
  vercel_args=(env pull "$credentials_file" --yes --environment=development)
  if [[ -n "${VERCEL_TOKEN:-}" ]]; then
    vercel_args+=(--token "$VERCEL_TOKEN")
  fi
  vercel "${vercel_args[@]}"
)

set -a
# shellcheck disable=SC1090
source "$credentials_file"
set +a

if [[ -z "${VERCEL_OIDC_TOKEN:-}" ]]; then
  echo "VERCEL_OIDC_TOKEN was not returned by vercel env pull" >&2
  exit 1
fi

printf '%s' "$VERCEL_OIDC_TOKEN" | docker login vcr.vercel.com \
  --username oidc \
  --password-stdin

tag_args=()
image_refs=()
for image_tag in "${image_tags[@]}"; do
  image_ref="$image_repository:$image_tag"
  image_refs+=("$image_ref")
  tag_args+=(--tag "$image_ref")
done

echo "Publishing ${image_refs[*]}"

docker buildx build \
  -f "$project_dir/Dockerfile.sandbox" \
  --platform linux/amd64,linux/arm64 \
  "${tag_args[@]}" \
  --output "type=image,push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true" \
  "$project_dir"

echo "Published ${image_refs[*]}"
