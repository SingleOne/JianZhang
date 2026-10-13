import { ensureAppThemeStyles, initializeAppTheme } from '../lib/theme'
import { renderMainWindow } from './main-window'

const initialTheme = initializeAppTheme()
void ensureAppThemeStyles(initialTheme).then(renderMainWindow)
