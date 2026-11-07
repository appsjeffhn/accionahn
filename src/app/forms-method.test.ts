import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// A form submitted before hydration (slow network, JS off) uses its HTML method and
// action. Without a method that is a GET to the current page: the customer's name, phone
// and address would land in the URL (history, logs, Referer). Every <form> must say how it
// submits: method="post", or a server action (`action={fn}`, which React renders as a POST),
// or an explicit method="get" for search-like forms that carry no personal data.

const appDir = fileURLToPath(new URL('.', import.meta.url))

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith('.tsx') ? [join(dir, e.name)] : [],
  )
}

// The opening tag of each <form ...> (JSX attributes may span lines; `>` inside `{...}`
// such as arrow functions is skipped by counting braces).
function formTags(src: string): string[] {
  const tags: string[] = []
  for (const m of src.matchAll(/<form\b/g)) {
    let depth = 0
    let i = m.index! + 5
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    tags.push(src.slice(m.index!, i + 1))
  }
  return tags
}

const declaresSubmission = (tag: string) => /\bmethod="(post|get)"/.test(tag) || /\baction=\{/.test(tag)

describe('every form declares how it submits', () => {
  it('the storefront and panel form kits post', () => {
    for (const file of ['(store)/store-forms.tsx', '(owner)/panel/form-kit.tsx']) {
      const tags = formTags(readFileSync(join(appDir, file), 'utf8'))
      expect(tags.length, file).toBeGreaterThan(0)
      for (const tag of tags) expect(tag, file).toMatch(/\bmethod="post"/)
    }
  })

  it('no <form> under src/app falls back to a GET by omission', () => {
    const offenders: string[] = []
    for (const file of tsxFiles(appDir)) {
      for (const tag of formTags(readFileSync(file, 'utf8'))) {
        if (!declaresSubmission(tag)) offenders.push(relative(appDir, file).split(sep).join('/'))
      }
    }
    expect(offenders).toEqual([])
  })

  it('the only GET forms are the day pickers, which carry no personal data', () => {
    const gets: string[] = []
    for (const file of tsxFiles(appDir)) {
      for (const tag of formTags(readFileSync(file, 'utf8'))) {
        if (/\bmethod="get"/.test(tag)) gets.push(relative(appDir, file).split(sep).join('/'))
      }
    }
    expect(gets.sort()).toEqual(['(store)/checkout/page.tsx', '(store)/p/[id]/page.tsx'])
  })
})
