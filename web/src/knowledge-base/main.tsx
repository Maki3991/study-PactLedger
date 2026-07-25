import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { KnowledgeBase } from './KnowledgeBase'
import './knowledge-base.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <KnowledgeBase />
  </StrictMode>,
)
