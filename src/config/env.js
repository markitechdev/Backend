import dotenv from 'dotenv';
dotenv.config();

const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
export const missingEnv = required.filter((k) => !process.env[k]);
const isServerless = Boolean(process.env.VERCEL);

if (missingEnv.length) {
  console.error(`\n[config] Missing environment variables: ${missingEnv.join(', ')}`);
  console.error('[config] Copy .env.example to .env (or set them in your hosting dashboard).\n');
  // A local server should stop immediately; on Vercel the app answers every
  // request with a clear 500 instead of crashing without an explanation.
  if (!isServerless && process.env.NODE_ENV !== 'test') process.exit(1);
}

/** "https://*.vercel.app" style entries become patterns; everything else must match exactly. */
const toMatcher = (origin) => {
  if (!origin.includes('*')) return (o) => o === origin;
  const re = new RegExp(`^${origin.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[a-z0-9-]+')}$`, 'i');
  return (o) => re.test(o);
};

const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

export const env = {
  port: Number(process.env.PORT) || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isServerless,
  supabaseUrl: process.env.SUPABASE_URL || 'http://missing-supabase-url.invalid',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || 'missing',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'missing',
  corsOrigins,
  isAllowedOrigin: (origin) => corsOrigins.some((o) => toMatcher(o)(origin)),
};
