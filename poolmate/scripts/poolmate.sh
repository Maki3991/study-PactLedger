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
  update      Rebuild current source, force-recreate containers, then health-check
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
    up|update|rebuild|restart|down|status|logs|health|init-env)
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
  if [[ -f "$default_env_file" ]]; then
    env_file="$default_env_file"
  else
    env_file="$(detect_existing_env_file)"
    env_file="${env_file:-$default_env_file}"
  fi
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

backend_port() {
  if [[ -n "${POOLMATE_BACKEND_PORT:-}" ]]; then
    printf '%s\n' "$POOLMATE_BACKEND_PORT"
    return
  fi
  if [[ -f "$env_file" ]]; then
    awk -F '=' '
      /^[[:space:]]*POOLMATE_BACKEND_PORT[[:space:]]*=/ {
        value=$2
        gsub(/^[[:space:]"]+|[[:space:]"]+$/, "", value)
        print value
        exit
      }
    ' "$env_file"
    return
  fi
  printf '8788\n'
}

env_value() {
  local key="$1"
  if [[ -n "${!key:-}" ]]; then
    printf '%s\n' "${!key}"
    return
  fi
  if [[ -f "$env_file" ]]; then
    awk -F '=' -v key="$key" '
      $1 == key {
        value=$2
        sub(/#.*/, "", value)
        gsub(/^[[:space:]"]+|[[:space:]"]+$/, "", value)
        print value
        exit
      }
    ' "$env_file"
  fi
}

validate_runtime_env() {
  case "$action" in
    up|update|rebuild|restart) ;;
    *) return 0 ;;
  esac

  if [[ ! -f "$env_file" ]]; then
    echo "Env file not found: $env_file" >&2
    exit 1
  fi

  if [[ -z "$(env_value TELEGRAM_BOT_TOKEN)" ]]; then
    echo "TELEGRAM_BOT_TOKEN is required in $env_file." >&2
    exit 1
  fi

  case "$(env_value POOLMATE_LLM_ENABLED | tr '[:upper:]' '[:lower:]')" in
    false|0|no|off)
      echo "POOLMATE_LLM_ENABLED disables natural-language command skill calling in $env_file." >&2
      echo "Refusing to start a Telegram bot with LLM command skills disabled." >&2
      exit 1
      ;;
  esac

  if [[ -z "$(env_value AIPING_API_KEY)" \
    && -z "$(env_value DEEPSEEK_API_KEY)" \
    && -z "$(env_value POOLMATE_LLM_API_KEY)" ]]; then
    echo "One LLM API key is required in $env_file: AIPING_API_KEY, DEEPSEEK_API_KEY, or POOLMATE_LLM_API_KEY." >&2
    echo "Refusing to start a Telegram bot that cannot perform command skill calling." >&2
    exit 1
  fi
}

wait_for_backend() {
  echo "Waiting for backend container health"
  for _ in $(seq 1 60); do
    if docker compose "${compose_args[@]}" exec --no-TTY backend \
      node -e '
        fetch("http://127.0.0.1:8788/health/ready")
          .then(async (response) => {
            const body = await response.text();
            if (!response.ok) process.exit(1);
            process.stdout.write(body);
          })
          .catch(() => process.exit(1));
      ' 2>/dev/null; then
      printf '\n'
      return 0
    fi
    sleep 1
  done
  echo "Backend container did not become healthy." >&2
  docker compose "${compose_args[@]}" ps >&2 || true
  docker compose "${compose_args[@]}" logs --tail 120 backend >&2 || true
  exit 1
}

verify_runtime() {
  echo "Verifying Telegram bot and LLM runtime"
  if docker compose "${compose_args[@]}" exec --no-TTY backend \
    node -e '
      fetch("http://127.0.0.1:8788/api/public/config-status")
        .then(async (response) => {
          if (!response.ok) throw new Error("config status request failed");
          const status = await response.json();
          const summary = {
            bot: status.bot?.status,
            llm: status.llm?.status,
            model: status.llm?.model
          };
          process.stdout.write(JSON.stringify(summary));
          if (status.bot?.status !== "running") process.exitCode = 1;
          if (status.llm?.status !== "configured") process.exitCode = 1;
        })
        .catch(() => process.exit(1));
    '; then
    printf '\n'
    return 0
  fi
  printf '\n' >&2
  echo "PoolMate runtime verification failed: bot and LLM must both be configured." >&2
  docker compose "${compose_args[@]}" logs --tail 120 backend >&2 || true
  exit 1
}

verify_command_skill_call() {
  echo "Verifying live LLM command skill call"
  if docker compose "${compose_args[@]}" exec --no-TTY backend \
    node --input-type=module -e '
      import { loadConfig } from "./dist/config.js";
      import { createCommandSkillInvoker } from "./dist/infrastructure/llm/httpCommandSkillInvoker.js";

      const invoker = createCommandSkillInvoker(loadConfig().llm);
      invoker
        .invoke({
          text: "怎么用",
          locale: "zh",
          surface: "telegram_mention"
        })
        .then((result) => {
          process.stdout.write(
            JSON.stringify({
              skillId: result.skillId,
              confidence: result.confidence
            })
          );
          if (result.skillId !== "general_help") process.exitCode = 1;
        })
        .catch((error) => {
          process.stderr.write(
            JSON.stringify({
              error:
                typeof error?.code === "string"
                  ? error.code
                  : "LLM_COMMAND_SKILL_SMOKE_FAILED"
            })
          );
          process.exit(1);
        });
    '; then
    printf '\n'
    return 0
  fi
  printf '\n' >&2
  echo "PoolMate LLM smoke test failed: expected general_help for 怎么用." >&2
  docker compose "${compose_args[@]}" logs --tail 120 backend >&2 || true
  exit 1
}

validate_runtime_env

case "$action" in
  up)
    docker compose "${compose_args[@]}" up --detach --build
    wait_for_backend
    verify_runtime
    verify_command_skill_call
    ;;
  update)
    docker compose "${compose_args[@]}" up --detach --build --force-recreate --remove-orphans
    wait_for_backend
    verify_runtime
    verify_command_skill_call
    docker compose "${compose_args[@]}" ps
    ;;
  rebuild)
    docker compose "${compose_args[@]}" up --detach --build --force-recreate
    wait_for_backend
    verify_runtime
    verify_command_skill_call
    ;;
  restart)
    docker compose "${compose_args[@]}" restart
    wait_for_backend
    verify_runtime
    verify_command_skill_call
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
    backend_port="$(backend_port)"
    backend_port="${backend_port:-8788}"
    curl --fail --silent --show-error \
      "http://127.0.0.1:${backend_port}/health"
    printf '\n'
    ;;
esac
