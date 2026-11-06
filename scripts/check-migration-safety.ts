import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// Backward-compatible migrations: old app code keeps running while a migration
// is applied, so a migration may add things but never remove or reshape them.
//
// Allowlist of harmless `drop` forms (named so a reviewer can see what is exempt):
//   - policy, trigger, function, procedure, rule: re-created in the same file
//     (drop ... if exists followed by create).
//   - index, view: derived objects that hold no data.
//   - constraint: relaxing or re-creating a rule the migration owns.
//   - not, default, identity, expression: `alter column ... drop not null/default/...`
//     relax a column, they never remove data.
// Dynamic SQL inside strings (execute 'drop table t') is invisible by design:
// string literals are blanked, so such statements need review by a human.
// A justified destructive change must carry `-- allow-unsafe: <reason>` on the same
// line as the offending keyword so it is visible in review.
const ALLOWED_DROP_KINDS = new Set([
  'policy', 'trigger', 'function', 'procedure', 'rule',
  'index', 'view', 'materialized',
  'constraint',
  'not', 'default', 'identity', 'expression',
])

const DESTRUCTIVE_DROP_MESSAGES: Record<string, string> = {
  table: 'drop table removes data',
  column: 'drop column removes data',
  schema: 'drop schema removes data',
}

const ESCAPE_HATCH = /^--\s*allow-unsafe:\s*\S/

type Prepared = { code: string; allowedLines: Set<number> }

// Blanks out comments and string literals (keeping newlines so offsets still map
// to lines) and records lines carrying a justified escape hatch.
function prepare(sql: string): Prepared {
  const allowedLines = new Set<number>()
  let code = ''
  let line = 1
  let i = 0
  const blank = (s: string) => s.replace(/[^\n]/g, ' ')
  while (i < sql.length) {
    const two = sql.slice(i, i + 2)
    if (two === '--') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      if (ESCAPE_HATCH.test(sql.slice(i, stop))) allowedLines.add(line)
      code += blank(sql.slice(i, stop))
      i = stop
    } else if (two === '/*') {
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql.startsWith('/*', j)) { depth++; j += 2 }
        else if (sql.startsWith('*/', j)) { depth--; j += 2 }
        else j++
      }
      const chunk = sql.slice(i, j)
      line += (chunk.match(/\n/g) ?? []).length
      code += blank(chunk)
      i = j
    } else if (sql[i] === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") j += 2
        else if (sql[j] === "'") { j++; break }
        else j++
      }
      const chunk = sql.slice(i, j)
      line += (chunk.match(/\n/g) ?? []).length
      code += blank(chunk)
      i = j
    } else {
      if (sql[i] === '\n') line++
      code += sql[i]
      i++
    }
  }
  return { code, allowedLines }
}

type Rule = { pattern: RegExp; message: (m: RegExpExecArray) => string | null }

// Each pattern captures the dangerous keyword in group 1; its line is the one reported.
const RULES: Rule[] = [
  {
    pattern: /\b(drop)\s+([a-z_"]+)/gi,
    message: (m) => {
      const kind = m[2].toLowerCase()
      if (ALLOWED_DROP_KINDS.has(kind)) return null
      return DESTRUCTIVE_DROP_MESSAGES[kind] ?? `drop ${kind} removes an object`
    },
  },
  { pattern: /\b(rename)\s+column\b/gi, message: () => 'rename column breaks old code' },
  { pattern: /\b(rename)\s+to\b/gi, message: () => 'rename to breaks old code' },
  {
    pattern: /\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?[\w."]+\s+(rename)\s+(?!to\b|column\b|constraint\b)[\w"]+\s+to\b/gi,
    message: () => 'rename column breaks old code',
  },
  {
    pattern: /\balter\s+(?:column\s+)?[\w"]+\s+(?:set\s+data\s+)?(type)\b/gi,
    message: () => 'alter column type may rewrite or break data',
  },
  { pattern: /\b(truncate)\b/gi, message: () => 'truncate removes data' },
]

export function checkMigrationSafety(sql: string): string[] {
  const { code, allowedLines } = prepare(sql)
  const found = new Map<number, string>()
  for (const rule of RULES) {
    for (const m of code.matchAll(rule.pattern)) {
      const message = rule.message(m)
      if (!message) continue
      const offset = m.index + m[0].toLowerCase().indexOf(m[1].toLowerCase())
      const line = code.slice(0, offset).split('\n').length
      if (allowedLines.has(line)) continue
      found.set(offset, `line ${line}: ${message}`)
    }
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
}

function main(): void {
  const dir = join(process.cwd(), 'supabase', 'migrations')
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  let bad = 0
  for (const file of files) {
    for (const violation of checkMigrationSafety(readFileSync(join(dir, file), 'utf8'))) {
      console.error(`${file}:${violation.replace(/^line (\d+): /, '$1: ')}`)
      bad++
    }
  }
  if (bad > 0) {
    console.error(`${bad} unsafe migration statement(s). Add "-- allow-unsafe: <reason>" only if justified.`)
    process.exit(1)
  }
  console.log(`${files.length} migration(s) checked, none unsafe.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
