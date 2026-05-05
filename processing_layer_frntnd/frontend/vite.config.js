import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Handsontable v17 doesn't list its CSS in its package `exports` field.
// Vite 8 strictly enforces exports, so we stub the CSS import here and
// load the actual styles via a CDN link in index.html.
const handsontableCssStub = {
  name: 'handsontable-css-stub',
  enforce: 'pre',
  resolveId(id) {
    if (id.includes('handsontable') && id.endsWith('.css')) {
      return '\0handsontable-css-stub'
    }
  },
  load(id) {
    if (id === '\0handsontable-css-stub') {
      return '/* Handsontable CSS is loaded via CDN in index.html */'
    }
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), handsontableCssStub],
})
