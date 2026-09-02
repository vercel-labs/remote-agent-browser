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

if ! command -v docker >/dev/null 2>&1; then
  echo "Required command not found: docker" >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker Buildx is required" >&2
  exit 1
fi

registry_username=oidc
registry_password="${VERCEL_OIDC_TOKEN:-}"

if [[ -z "$registry_password" && -n "${VERCEL_TOKEN:-}" && -n "${VERCEL_TEAM_ID:-}" ]]; then
  registry_username="$VERCEL_TEAM_ID"
  registry_password="$VERCEL_TOKEN"
fi

if [[ -z "$registry_password" ]]; then
  if ! command -v vercel >/dev/null 2>&1; then
    echo "Set VERCEL_OIDC_TOKEN, set VERCEL_TOKEN and VERCEL_TEAM_ID, or install the Vercel CLI" >&2
    exit 1
  fi

  credentials_file="$(mktemp "${TMPDIR:-/tmp}/remote-agent-browser-env.XXXXXX")"
  trap 'rm -f "$credentials_file"' EXIT

  (
    cd "$project_dir"
    vercel env pull "$credentials_file" --yes --environment=development
  )

  set -a
  # shellcheck disable=SC1090
  source "$credentials_file"
  set +a

  registry_password="${VERCEL_OIDC_TOKEN:-}"
fi

if [[ -z "$registry_password" ]]; then
  echo "VCR credentials are required to publish the image" >&2
  exit 1
fi

printf '%s' "$registry_password" | docker login vcr.vercel.com \
  --username "$registry_username" \
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
  --pull \
  --no-cache \
  "${tag_args[@]}" \
  --output "type=image,push=true,oci-mediatypes=true,compression=zstd,compression-level=3,force-compression=true" \
  "$project_dir"

echo "Published ${image_refs[*]}"
