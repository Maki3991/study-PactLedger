import { config as loadDotenv } from 'dotenv'

export function loadEnvironment(): void {
  loadDotenv({ path: ['.env.local', '.env'], quiet: true })
}
