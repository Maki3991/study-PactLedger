#!/usr/bin/env bash

set -Eeuo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
poolmate_dir="$(CDPATH= cd -- "${script_dir}/.." && pwd)"
compose_file="${poolmate_dir}/deploy/compose.yaml"
default_env_file="${poolmate_dir}/deploy/.env"

action="up"
project_name="${POOLMATE_COMPOSE_PROJECT:-}"
env_file="${POOLMATE_ENV_FILE:-}"
env_file_explicit=false

usage() {
  cat <<'USAGE'
Usage: scripts/poolmate.sh [action] [options]

Actions:
  up          Build and start PoolMate in the background (default)
  rebuild     Rebuild and force-recreate PoolMate containers
  restart     Restart existing PoolMate containers
  down        Stop containers without deleting the data volume
  status      Show container status
  logs        Follow backend and frontend logs
  health      Query the local backend health endpoint
  init-env    Create deploy/.env from deploy/env.example

Options:
  --env-file PATH   Compose env file; relative paths use the current directory
  --project NAME    Compose project name
  -h, --help        Show this help

Environment overrides:
  POOLMATE_ENV_FILE
  POOLMATE_COMPOSE_PROJECT
  POOLMATE_BACKEND_PORT
USAGE
}

resolve_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s\n' "$(pwd)/$1" ;;
  esac
}

while (($# > 0)); do
  case "$1" in
    up|rebuild|restart|down|status|logs|health|init-env)
      action="$1"
      shift
      ;;
    --env-file)
      (($# >= 2)) || { echo "Missing value for --env-file." >&2; exit 2; }
      env_file="$(resolve_path "$2")"
      env_file_explicit=true
      shift 2
      ;;
    --project)
      (($# >= 2)) || { echo "Missing value for --project." >&2; exit 2; }
      project_name="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

command -v docker >/dev/null 2>&1 || {
  echo "Docker is required." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Docker Compose v2 is required." >&2
  exit 1
}

detect_existing_project() {
  docker ps -a \
    --filter label=com.docker.compose.service=backend \
    --format '{{.Label "com.docker.compose.project"}}|{{.Label "com.docker.compose.project.config_files"}}' \
    2>/dev/null |
    awk -F '|' -v compose_file="$compose_file" '$2 == compose_file { print $1; exit }'
}

if [[ -z "$project_name" ]]; then
  project_name="$(detect_existing_project)"
  project_name="${project_name:-poolmate}"
fi

detect_existing_env_file() {
  local container_id
  container_id="$({
    docker ps -a \
      --filter "label=com.docker.compose.project=${project_name}" \
      --filter label=com.docker.compose.service=backend \
      --format '{{.ID}}' 2>/dev/null || true
  } | head -n 1)"
  if [[ -n "$container_id" ]]; then
    docker inspect "$container_id" \
      --format '{{ index .Config.Labels "com.docker.compose.project.environment_file" }}' \
      2>/dev/null || true
  fi
}

if [[ -z "$env_file" ]]; then
  env_file="$(detect_existing_env_file)"
  env_file="${env_file:-$default_env_file}"
elif [[ "$env_file" != /* ]]; then
  env_file="$(resolve_path "$env_file")"
fi

if [[ "$action" == "init-env" ]]; then
  if [[ "$env_file_explicit" == false ]]; then
    env_file="$default_env_file"
  fi
  if [[ -e "$env_file" ]]; then
    echo "Env file already exists: $env_file" >&2
    exit 1
  fi
  cp "${poolmate_dir}/deploy/env.example" "$env_file"
  chmod 600 "$env_file"
  echo "Created: $env_file"
  echo "Set TELEGRAM_BOT_TOKEN, POOLMATE_PUBLIC_BASE_URL, and AIPING_API_KEY before starting."
  exit 0
fi

compose_args=(--project-name "$project_name" --file "$compose_file")
if [[ -f "$env_file" ]]; then
  compose_args+=(--env-file "$env_file")
elif [[ "$action" == "up" || "$action" == "rebuild" ]]; then
  echo "Env file not found: $env_file" >&2
  echo "Run: scripts/poolmate.sh init-env" >&2
  echo "Or pass: --env-file path/to/poolmate.env" >&2
  exit 1
fi

echo "PoolMate project: $project_name"
if [[ -f "$env_file" ]]; then
  echo "Environment file: $env_file"
fi

case "$action" in
  up)
    docker compose "${compose_args[@]}" up --detach --build
    ;;
  rebuild)
    docker compose "${compose_args[@]}" up --detach --build --force-recreate
    ;;
  restart)
    docker compose "${compose_args[@]}" restart
    ;;
  down)
    docker compose "${compose_args[@]}" down
    ;;
  status)
    docker compose "${compose_args[@]}" ps
    ;;
  logs)
    docker compose "${compose_args[@]}" logs --follow --tail 200 backend frontend
    ;;
  health)
    backend_port="${POOLMATE_BACKEND_PORT:-8788}"
    curl --fail --silent --show-error \
      "http://127.0.0.1:${backend_port}/health"
    printf '\n'
    ;;
esac
