// D13 密钥纪律：客户端只允许出现 URL 与 anon key（受 RLS 保护，本来就是公开的）。
// 任何 service role / Gemini / Groq / Claude 密钥只进服务端环境变量。
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
