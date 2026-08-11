-- Task 1: NFC tag provisioning table for Web NFC check-in fallback path.
-- Each student may bind one NFC tag (sticker/card or phone acting as NFC tag) to
-- their account. The tag_uid is the raw identifier read by NDEFReader.scan() in the
-- browser. Check-ins resolve tag_uid -> student_id via this table.
--
-- Scope note: this table supports the Web NFC API path (browser-native, no vendor SDK).
-- Physical RFID reader hardware integration remains a scaffolded extension point via
-- the HardwareCheckinAdapter interface — it is NOT a shipped feature.

CREATE TABLE IF NOT EXISTS public.student_nfc_bindings (
  student_id UUID PRIMARY KEY REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  tag_uid   TEXT NOT NULL UNIQUE,
  bound_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bound_by  UUID REFERENCES public.profiles(user_id)
);

ALTER TABLE public.student_nfc_bindings ENABLE ROW LEVEL SECURITY;

-- Service role (server functions) has full access.
CREATE POLICY "student_nfc_bindings: service role full access"
  ON public.student_nfc_bindings FOR ALL
  USING (auth.role() = 'service_role');

-- Students can read their own binding (to know if they have a card provisioned).
CREATE POLICY "student_nfc_bindings: students read own"
  ON public.student_nfc_bindings FOR SELECT
  USING (auth.uid() = student_id);

-- Admins can read all bindings (for the provisioning management UI).
CREATE POLICY "student_nfc_bindings: admins read all"
  ON public.student_nfc_bindings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

CREATE INDEX idx_student_nfc_bindings_tag_uid ON public.student_nfc_bindings(tag_uid);