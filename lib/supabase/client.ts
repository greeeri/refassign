import { createBrowserClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Public, read-limited credentials for the isolated league-tier test project.
// Production continues to use its configured environment variables.
const testUrl = 'https://slenztuopbfxqzjyrtzp.supabase.co'
const testPublishableKey = 'sb_publishable_Hz_2BH4cYmrogX3O15x2PQ_fU-0uSKZ'
let tierTestBrowserClient: ReturnType<typeof createBrowserClient> | undefined

function browserConfiguration() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || testUrl,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || testPublishableKey
  }
}

export function createClient() {
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
