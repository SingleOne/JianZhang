import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { TaskbarTicker } from './components/TaskbarTicker'
import './styles.css'

const taskbarMode = new URLSearchParams(window.location.search).get('mode') === 'taskbar'
document.documentElement.classList.toggle('taskbar-mode', taskbarMode)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {taskbarMode ? <TaskbarTicker /> : <App />}
  </StrictMode>
)
