-- =========================
-- Fees & Finance
-- =========================

CREATE TYPE public.fee_category AS ENUM ('tuition', 'hostel', 'exam', 'library', 'transport', 'misc');
CREATE TYPE public.invoice_status AS ENUM ('pending', 'partial', 'paid', 'overdue', 'waived');
CREATE TYPE public.payment_method AS ENUM ('razorpay', 'cash', 'cheque', 'bank_transfer');
CREATE TYPE public.payment_status AS ENUM ('created', 'success', 'failed', 'refunded');

CREATE TABLE public.fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id uuid REFERENCES public.programs(id) ON DELETE CASCADE,
  semester_id uuid REFERENCES public.semesters(id) ON DELETE RESTRICT,
  name text NOT NULL,
  category public.fee_category NOT NULL DEFAULT 'tuition',
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  due_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fee_structures TO authenticated;
GRANT ALL ON public.fee_structures TO service_role;
ALTER TABLE public.fee_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fee_structures_read" ON public.fee_structures FOR SELECT TO authenticated USING (true);
CREATE POLICY "fee_structures_admin_write" ON public.fee_structures
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fee_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  fee_structure_id uuid NOT NULL REFERENCES public.fee_structures(id) ON DELETE RESTRICT,
  amount_due numeric(10, 2) NOT NULL CHECK (amount_due > 0),
  amount_paid numeric(10, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  status public.invoice_status NOT NULL DEFAULT 'pending',
  due_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, fee_structure_id)
);
GRANT SELECT ON public.fee_invoices TO authenticated;
GRANT ALL ON public.fee_invoices TO service_role;
ALTER TABLE public.fee_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fee_invoices_student_read_own" ON public.fee_invoices
  FOR SELECT TO authenticated USING (auth.uid() = student_id);
CREATE POLICY "fee_invoices_guardian_read" ON public.fee_invoices
  FOR SELECT TO authenticated USING (private.is_guardian_of(auth.uid(), student_id));
CREATE POLICY "fee_invoices_admin_all" ON public.fee_invoices
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

CREATE TABLE public.fee_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.fee_invoices(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.profiles(user_id) ON DELETE CASCADE,
  amount numeric(10, 2) NOT NULL CHECK (amount > 0),
  method public.payment_method NOT NULL,
  status public.payment_status NOT NULL DEFAULT 'created',
  razorpay_order_id text,
  razorpay_payment_id text,
  razorpay_signature text,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT, -- set for manual (cash/cheque/bank) entries
  notes text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.fee_payments TO authenticated;
GRANT ALL ON public.fee_payments TO service_role;
ALTER TABLE public.fee_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fee_payments_student_read_own" ON public.fee_payments
  FOR SELECT TO authenticated USING (auth.uid() = student_id);
CREATE POLICY "fee_payments_guardian_read" ON public.fee_payments
  FOR SELECT TO authenticated USING (private.is_guardian_of(auth.uid(), student_id));
CREATE POLICY "fee_payments_admin_all" ON public.fee_payments
  FOR ALL TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- Payments are a financial audit trail: block UPDATE/DELETE from the client
-- entirely. Reconciliation adjustments (refunds, corrections) are modeled as
-- new rows, not edits to existing ones. service_role (server functions) can
-- still update paid_at/status once on confirmation via a narrow trigger-free
-- path since it runs as service_role, which bypasses RLS by design.
REVOKE UPDATE, DELETE ON public.fee_payments FROM authenticated;
