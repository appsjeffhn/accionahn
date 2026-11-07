import { describe, expect, it } from 'vitest'
import { checkMigrationSafety } from './check-migration-safety'

describe('checkMigrationSafety', () => {
  it.each([
    ['drop column', 'alter table t drop column c;'],
    ['drop table', 'drop table t;'],
    ['drop table if exists', 'drop table if exists t;'],
    ['rename column', 'alter table t rename column a to b;'],
    ['rename column without keyword', 'alter table t rename a to b;'],
    ['rename to', 'alter table t rename to u;'],
    ['alter column type', 'alter table t alter column c type bigint;'],
    ['alter column set data type', 'alter table t alter column c set data type bigint;'],
    ['drop schema', 'drop schema s cascade;'],
    ['truncate', 'truncate table t;'],
    ['alter type without column keyword', 'alter table t alter c type bigint;'],
    ['alter set data type without column keyword', 'alter table t alter c set data type text;'],
    ['alter type multi-line uppercase', 'ALTER TABLE t\n  ALTER c TYPE int;'],
    ['bare drop column', 'alter table t drop c;'],
  ])('flags %s', (_name, sql) => {
    expect(checkMigrationSafety(sql)).toHaveLength(1)
  })

  it.each([
    ['create table', 'create table t (id int);'],
    ['add column', 'alter table t add column c int;'],
    ['create index', 'create index i on t (c);'],
    ['drop policy if exists', 'drop policy if exists p on t;'],
    ['drop trigger if exists', 'drop trigger if exists g on t;'],
    ['drop function if exists', 'drop function if exists f();'],
    ['drop index', 'drop index if exists i;'],
    ['drop constraint', 'alter table t drop constraint k;'],
    ['drop not null', 'alter table t alter column c drop not null;'],
    ['set default', 'alter table t alter column c set default 1;'],
    ['set not null without column keyword', 'alter table t alter c set not null;'],
    ['drop default', 'alter table t alter column c drop default;'],
  ])('allows %s', (_name, sql) => {
    expect(checkMigrationSafety(sql)).toEqual([])
  })

  it('catches multi-line statements and reports the line', () => {
    const v = checkMigrationSafety('select 1;\nALTER TABLE x\n  DROP COLUMN y;')
    expect(v).toHaveLength(1)
    expect(v[0]).toMatch(/^line 3:/)
  })

  it('is case insensitive', () => {
    expect(checkMigrationSafety('DROP TABLE T;')).toHaveLength(1)
    expect(checkMigrationSafety('TrUnCaTe t;')).toHaveLength(1)
  })

  it('ignores comments and string literals', () => {
    expect(checkMigrationSafety('-- drop table t;\nselect 1;')).toEqual([])
    expect(checkMigrationSafety('/* alter table t drop column c; */ select 1;')).toEqual([])
    expect(checkMigrationSafety("insert into n values ('drop table t; -- x');")).toEqual([])
  })

  it('accepts a justified escape hatch on the same line only', () => {
    const ok = 'alter table t drop column c; -- allow-unsafe: column unused since v3'
    expect(checkMigrationSafety(ok)).toEqual([])
    const wrongLine = '-- allow-unsafe: reason\nalter table t drop column c;'
    expect(checkMigrationSafety(wrongLine)).toHaveLength(1)
    expect(checkMigrationSafety('drop table t; -- allow-unsafe:')).toHaveLength(1)
  })

  it('reports each violation', () => {
    expect(checkMigrationSafety('drop table a;\ndrop table b;')).toHaveLength(2)
  })
})
