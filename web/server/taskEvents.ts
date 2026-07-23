import { EventEmitter } from 'node:events'
import type { TaskSnapshot } from '../src/domain/trading.js'

export class TaskEvents {
  private readonly emitter = new EventEmitter()

  publish(snapshot: TaskSnapshot): void {
    this.emitter.emit(snapshot.id, snapshot)
  }

  subscribe(taskId: string, listener: (snapshot: TaskSnapshot) => void): () => void {
    this.emitter.on(taskId, listener)
    return () => this.emitter.off(taskId, listener)
  }
}
