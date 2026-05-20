-- 1. profiles: lock down INSERT/DELETE to owner
DROP POLICY IF EXISTS "Authenticated users can insert profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can delete profiles" ON public.profiles;

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own profile"
ON public.profiles FOR DELETE TO authenticated
USING (auth.uid() = user_id);

-- 2. ai_usage_log: own-row reads only
DROP POLICY IF EXISTS "auth read usage" ON public.ai_usage_log;
DROP POLICY IF EXISTS "auth insert usage" ON public.ai_usage_log;

CREATE POLICY "Users read own usage"
ON public.ai_usage_log FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own usage"
ON public.ai_usage_log FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- 3. ai_model_pricing: read-only for clients; writes go through service role (bypasses RLS)
DROP POLICY IF EXISTS "auth write pricing" ON public.ai_model_pricing;
-- "auth read pricing" SELECT policy already exists and is fine

-- 4. SECURITY DEFINER functions: revoke direct execute from anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.registrar_evento_viagem_excluido() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

-- 5. storage.objects: add policies for the private buckets (internal app — any authenticated user)
CREATE POLICY "Authenticated can read private buckets"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id IN ('demonstracoes-pdf','editais-pdf','base-conhecimento-pdf'));

CREATE POLICY "Authenticated can upload private buckets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id IN ('demonstracoes-pdf','editais-pdf','base-conhecimento-pdf'));

CREATE POLICY "Authenticated can update private buckets"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id IN ('demonstracoes-pdf','editais-pdf','base-conhecimento-pdf'));

CREATE POLICY "Authenticated can delete private buckets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id IN ('demonstracoes-pdf','editais-pdf','base-conhecimento-pdf'));