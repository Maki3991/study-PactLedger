import { config as loadDotenv } from 'dotenv'

export function loadEnvironment(): void {
  loadDotenv({ path: ['.env.local', '.env', '../server/.env'], quiet: true })
}
