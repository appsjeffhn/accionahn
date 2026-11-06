import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'
import { isLocale, LOCALE_COOKIE, TENANT_LOCALE_HEADER } from '@/lib/i18n/config'
import { resolveLocale } from '@/lib/i18n/locale'

export default getRequestConfig(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()])
  const tenantHeader = headerStore.get(TENANT_LOCALE_HEADER) ?? undefined
  const locale = resolveLocale({
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language') ?? undefined,
    tenantDefault: isLocale(tenantHeader) ? tenantHeader : undefined,
  })
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  }
})
