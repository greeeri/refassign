import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Public, read-limited credentials for the isolated league-tier test project.
// Production continues to use its configured environment variables.
const testUrl = 'https://slenztuopbfxqzjyrtzp.supabase.co'
const testPublishableKey = 'sb_publishable_Hz_2BH4cYmrogX3O15x2PQ_fU-0uSKZ'
let tierTestBrowserClient: ReturnType<typeof createBrowserClient> | undefined

export function isTierTestRuntime() {
  if (typeof window === 'undefined') return false
  return window.location.hostname === 'test.ref-assign.com' ||
    process.env.NEXT_PUBLIC_SUPABASE_URL === testUrl
}

function browserConfiguration() {
  if (isTierTestRuntime()) {
    return { url: testUrl, key: testPublishableKey }
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || testUrl,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || testPublishableKey
  }
}

export function createClient() {
  // The isolated setup and full workspace must share the same browser session.
  // @supabase/ssr stores sessions differently from the supabase-js client used
  // by the test setup, so return the cached test client on the test hostname.
  if (isTierTestRuntime()) {
    return createTierTestClient()
  }
  const config = browserConfiguration()
  return createBrowserClient(
    config.url,
    config.key
  )
}

// Tier testing must remain isolated even when Vercel injects production variables.
export function createTierTestClient() {
  if (!tierTestBrowserClient) {
    tierTestBrowserClient = createSupabaseClient(testUrl, testPublishableKey, {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      }
    }) as ReturnType<typeof createBrowserClient>
  }

  return tierTestBrowserClient
}

export function createPasswordRecoveryClient() {
  const config = browserConfiguration()
  return createSupabaseClient(
    config.url,
    config.key,
    {
      auth: {
        flowType: 'implicit',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true
      }
    }
  )
}
