-- Fix RLS policies for face_embeddings and enrollment_photos so authenticated users can upsert/delete their own row.
-- This ensures biometric enrollment succeeds seamlessly for students without RLS violations.

DROP POLICY IF EXISTS "embeddings_self_insert" ON public.face_embeddings;
CREATE POLICY "embeddings_self_insert" ON public.face_embeddings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "embeddings_self_update" ON public.face_embeddings;
CREATE POLICY "embeddings_self_update" ON public.face_embeddings
  FOR UPDATE TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "embeddings_self_delete" ON public.face_embeddings;
CREATE POLICY "embeddings_self_delete" ON public.face_embeddings
  FOR DELETE TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "enrollment_photos_insert_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_insert_own" ON public.enrollment_photos
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = student_id);

DROP POLICY IF EXISTS "enrollment_photos_update_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_update_own" ON public.enrollment_photos
  FOR UPDATE TO authenticated
  USING (auth.uid() = student_id);

DROP POLICY IF EXISTS "enrollment_photos_delete_own" ON public.enrollment_photos;
CREATE POLICY "enrollment_photos_delete_own" ON public.enrollment_photos
  FOR DELETE TO authenticated
  USING (auth.uid() = student_id);
