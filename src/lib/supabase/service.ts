import 'server-only'

// Importing this from a Client Component fails the build, so the service-role key
// can never reach the browser bundle.
export { createServiceClient } from './service-core'
