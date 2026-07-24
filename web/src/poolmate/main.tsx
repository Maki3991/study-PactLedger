import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PoolMate } from './PoolMate'
import './poolmate.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PoolMate />
  </StrictMode>,
)
