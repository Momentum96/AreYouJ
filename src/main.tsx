import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  // Temporarily disable StrictMode to fix WebSocket double connection issue
  // <StrictMode>
    <App />
  // </StrictMode>,
)
