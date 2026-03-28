import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import postcss from 'postcss'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const html = fs.readFileSync(path.join(root, 'main page.html'), 'utf8')
const start = html.indexOf('<style>')
const end = html.indexOf('</style>', start)
if (start < 0 || end < 0) throw new Error('style bounds not found')
let css = html.slice(start + 7, end).trim()

const SCOPE = '#main-page-root'

css = css.replace(/^:root\s*\{/m, `${SCOPE} {`)
css = css.replace(/\bbody\.dark-mode\b/g, `${SCOPE}.dark-mode`)

css = css.replace(/^\*, \*::before, \*::after \{[^}]+\}/m, `${SCOPE}, ${SCOPE} *, ${SCOPE} *::before, ${SCOPE} *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}`)

css = css.replace(/^html \{[^}]+\}\s*\nbody \{[^}]+\}/m, `${SCOPE} {
  font-family: var(--sans);
  background: var(--bg);
  color: var(--ink);
  min-height: 100vh;
  transition: background .2s ease, color .2s ease;
}`)

const ast = postcss.parse(css)
ast.walkRules((rule) => {
  let p = rule.parent
  while (p && p.type === 'rule') p = p.parent
  if (p && p.type === 'atrule' && p.name === 'keyframes') return

  const sel = rule.selector?.trim()
  if (!sel) return
  const parts = sel.split(',').map((s) => s.trim())
  const allScoped = parts.every((s) => s.startsWith(SCOPE))
  if (allScoped) return

  rule.selector = parts.map((s) => (s.startsWith(SCOPE) ? s : `${SCOPE} ${s}`)).join(', ')
})

const fontImport = `@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
`

const finalCss = fontImport + ast.toString()
fs.writeFileSync(path.join(root, 'src', 'app', '(protected)', 'main-page-reference.css'), finalCss)
console.log('Wrote main-page-reference.css', finalCss.length, 'chars')
