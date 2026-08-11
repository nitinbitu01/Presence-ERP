export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      attendance_events: {
        Row: {
          created_at: string;
          event_type: string;
          gate_reasons: Json;
          id: string;
          ip: string | null;
          liveness_method: string | null;
          reason_code: string | null;
          session_id: string;
          similarity: number | null;
          student_id: string;
          user_agent: string | null;
        };
        Insert: {
          created_at?: string;
          event_type: string;
          gate_reasons?: Json;
          id?: string;
          ip?: string | null;
          liveness_method?: string | null;
          reason_code?: string | null;
          session_id: string;
          similarity?: number | null;
          student_id: string;
          user_agent?: string | null;
        };
        Update: {
          created_at?: string;
          event_type?: string;
          gate_reasons?: Json;
          id?: string;
          ip?: string | null;
          liveness_method?: string | null;
          reason_code?: string | null;
          session_id?: string;
          similarity?: number | null;
          student_id?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_events_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "class_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_ledger: {
        Row: {
          created_at: string;
          decision: Database["public"]["Enums"]["attendance_decision"];
          device_fp_hash: string | null;
          gate_reasons: Json;
          geo_lat: number | null;
          geo_lng: number | null;
          id: string;
          ip: unknown;
          modified_by: string | null;
          previous_entry_id: string | null;
          reason_code: string | null;
          session_id: string;
          similarity: number | null;
          student_id: string;
        };
        Insert: {
          created_at?: string;
          decision: Database["public"]["Enums"]["attendance_decision"];
          device_fp_hash?: string | null;
          gate_reasons?: Json;
          geo_lat?: number | null;
          geo_lng?: number | null;
          id?: string;
          ip?: unknown;
          modified_by?: string | null;
          previous_entry_id?: string | null;
          reason_code?: string | null;
          session_id: string;
          similarity?: number | null;
          student_id: string;
        };
        Update: {
          created_at?: string;
          decision?: Database["public"]["Enums"]["attendance_decision"];
          device_fp_hash?: string | null;
          gate_reasons?: Json;
          geo_lat?: number | null;
          geo_lng?: number | null;
          id?: string;
          ip?: unknown;
          modified_by?: string | null;
          previous_entry_id?: string | null;
          reason_code?: string | null;
          session_id?: string;
          similarity?: number | null;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_ledger_previous_entry_id_fkey";
            columns: ["previous_entry_id"];
            isOneToOne: false;
            referencedRelation: "attendance_ledger";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_ledger_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "class_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_review_actions: {
        Row: {
          action: string;
          created_at: string;
          id: string;
          ledger_id: string;
          reason: string;
          reviewer_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          id?: string;
          ledger_id: string;
          reason: string;
          reviewer_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          id?: string;
          ledger_id?: string;
          reason?: string;
          reviewer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_review_actions_ledger_id_fkey";
            columns: ["ledger_id"];
            isOneToOne: true;
            referencedRelation: "attendance_ledger";
            referencedColumns: ["id"];
          },
        ];
      };
      biometric_consent: {
        Row: {
          allow_non_biometric_fallback: boolean;
          created_at: string;
          granted_at: string | null;
          id: string;
          policy_version: string;
          retention_until: string | null;
          student_id: string;
          withdrawn_at: string | null;
        };
        Insert: {
          allow_non_biometric_fallback?: boolean;
          created_at?: string;
          granted_at?: string | null;
          id?: string;
          policy_version: string;
          retention_until?: string | null;
          student_id: string;
          withdrawn_at?: string | null;
        };
        Update: {
          allow_non_biometric_fallback?: boolean;
          created_at?: string;
          granted_at?: string | null;
          id?: string;
          policy_version?: string;
          retention_until?: string | null;
          student_id?: string;
          withdrawn_at?: string | null;
        };
        Relationships: [];
      };
      biometric_withdrawals: {
        Row: {
          created_at: string;
          id: string;
          ip: string | null;
          reason: string | null;
          student_id: string;
          user_agent: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          ip?: string | null;
          reason?: string | null;
          student_id: string;
          user_agent?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          ip?: string | null;
          reason?: string | null;
          student_id?: string;
          user_agent?: string | null;
        };
        Relationships: [];
      };
      class_sessions: {
        Row: {
          course_id: string;
          created_at: string;
          ends_at: string;
          geo_lat: number;
          geo_lng: number;
          id: string;
          ip_allowlist: string[];
          radius_m: number;
          starts_at: string;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          ends_at: string;
          geo_lat: number;
          geo_lng: number;
          id?: string;
          ip_allowlist?: string[];
          radius_m?: number;
          starts_at: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          ends_at?: string;
          geo_lat?: number;
          geo_lng?: number;
          id?: string;
          ip_allowlist?: string[];
          radius_m?: number;
          starts_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "class_sessions_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          code: string;
          created_at: string;
          department_id: string | null;
          id: string;
          name: string;
          semester_id: string | null;
          teacher_id: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          department_id?: string | null;
          id?: string;
          name: string;
          semester_id?: string | null;
          teacher_id: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          department_id?: string | null;
          id?: string;
          name?: string;
          semester_id?: string | null;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "courses_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "courses_semester_id_fkey";
            columns: ["semester_id"];
            isOneToOne: false;
            referencedRelation: "semesters";
            referencedColumns: ["id"];
          },
        ];
      };
      institutions: {
        Row: {
          address: string | null;
          code: string;
          contact_email: string | null;
          created_at: string;
          id: string;
          is_active: boolean;
          logo_url: string | null;
          name: string;
          updated_at: string;
        };
        Insert: {
          address?: string | null;
          code: string;
          contact_email?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name: string;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          code?: string;
          contact_email?: string | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          logo_url?: string | null;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      departments: {
        Row: {
          code: string;
          created_at: string;
          id: string;
          institution_id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          id?: string;
          institution_id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          id?: string;
          institution_id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "departments_institution_id_fkey";
            columns: ["institution_id"];
            isOneToOne: false;
            referencedRelation: "institutions";
            referencedColumns: ["id"];
          },
        ];
      };
      device_fingerprints: {
        Row: {
          first_seen: string;
          fp_hash: string;
          id: string;
          last_seen: string;
          student_id: string;
        };
        Insert: {
          first_seen?: string;
          fp_hash: string;
          id?: string;
          last_seen?: string;
          student_id: string;
        };
        Update: {
          first_seen?: string;
          fp_hash?: string;
          id?: string;
          last_seen?: string;
          student_id?: string;
        };
        Relationships: [];
      };
      enrollments: {
        Row: {
          course_id: string;
          created_at: string;
          id: string;
          semester_id: string | null;
          student_id: string;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          id?: string;
          semester_id?: string | null;
          student_id: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          id?: string;
          semester_id?: string | null;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_semester_id_fkey";
            columns: ["semester_id"];
            isOneToOne: false;
            referencedRelation: "semesters";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enrollments_student_id_profiles_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      exams: {
        Row: {
          course_id: string;
          created_at: string;
          created_by: string;
          exam_date: string | null;
          exam_type: Database["public"]["Enums"]["exam_type"];
          id: string;
          is_published: boolean;
          max_marks: number;
          name: string;
          semester_id: string;
          updated_at: string;
          weightage_percent: number;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          created_by: string;
          exam_date?: string | null;
          exam_type?: Database["public"]["Enums"]["exam_type"];
          id?: string;
          is_published?: boolean;
          max_marks: number;
          name: string;
          semester_id: string;
          updated_at?: string;
          weightage_percent?: number;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          created_by?: string;
          exam_date?: string | null;
          exam_type?: Database["public"]["Enums"]["exam_type"];
          id?: string;
          is_published?: boolean;
          max_marks?: number;
          name?: string;
          semester_id?: string;
          updated_at?: string;
          weightage_percent?: number;
        };
        Relationships: [
          {
            foreignKeyName: "exams_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exams_semester_id_fkey";
            columns: ["semester_id"];
            isOneToOne: false;
            referencedRelation: "semesters";
            referencedColumns: ["id"];
          },
        ];
      };
      grade_scales: {
        Row: {
          created_at: string;
          id: string;
          is_default: boolean;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_default?: boolean;
          name?: string;
        };
        Relationships: [];
      };
      grade_bands: {
        Row: {
          grade_point: number;
          grade_scale_id: string;
          id: string;
          is_passing: boolean;
          letter: string;
          max_percent: number;
          min_percent: number;
        };
        Insert: {
          grade_point: number;
          grade_scale_id: string;
          id?: string;
          is_passing?: boolean;
          letter: string;
          max_percent: number;
          min_percent: number;
        };
        Update: {
          grade_point?: number;
          grade_scale_id?: string;
          id?: string;
          is_passing?: boolean;
          letter?: string;
          max_percent?: number;
          min_percent?: number;
        };
        Relationships: [
          {
            foreignKeyName: "grade_bands_grade_scale_id_fkey";
            columns: ["grade_scale_id"];
            isOneToOne: false;
            referencedRelation: "grade_scales";
            referencedColumns: ["id"];
          },
        ];
      };
      exam_marks: {
        Row: {
          entered_at: string;
          entered_by: string;
          exam_id: string;
          id: string;
          is_absent: boolean;
          marks_obtained: number | null;
          remarks: string | null;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          entered_at?: string;
          entered_by: string;
          exam_id: string;
          id?: string;
          is_absent?: boolean;
          marks_obtained?: number | null;
          remarks?: string | null;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          entered_at?: string;
          entered_by?: string;
          exam_id?: string;
          id?: string;
          is_absent?: boolean;
          marks_obtained?: number | null;
          remarks?: string | null;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "exam_marks_exam_id_fkey";
            columns: ["exam_id"];
            isOneToOne: false;
            referencedRelation: "exams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "exam_marks_student_id_profiles_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      guardians: {
        Row: {
          created_at: string;
          display_name: string;
          phone: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          phone?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          phone?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      guardian_students: {
        Row: {
          created_at: string;
          guardian_id: string;
          id: string;
          is_primary: boolean;
          relationship: string;
          student_id: string;
        };
        Insert: {
          created_at?: string;
          guardian_id: string;
          id?: string;
          is_primary?: boolean;
          relationship?: string;
          student_id: string;
        };
        Update: {
          created_at?: string;
          guardian_id?: string;
          id?: string;
          is_primary?: boolean;
          relationship?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "guardian_students_guardian_id_fkey";
            columns: ["guardian_id"];
            isOneToOne: false;
            referencedRelation: "guardians";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "guardian_students_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      fee_structures: {
        Row: {
          amount: number;
          category: Database["public"]["Enums"]["fee_category"];
          created_at: string;
          created_by: string;
          due_date: string;
          id: string;
          name: string;
          program_id: string | null;
          semester_id: string | null;
        };
        Insert: {
          amount: number;
          category?: Database["public"]["Enums"]["fee_category"];
          created_at?: string;
          created_by: string;
          due_date: string;
          id?: string;
          name: string;
          program_id?: string | null;
          semester_id?: string | null;
        };
        Update: {
          amount?: number;
          category?: Database["public"]["Enums"]["fee_category"];
          created_at?: string;
          created_by?: string;
          due_date?: string;
          id?: string;
          name?: string;
          program_id?: string | null;
          semester_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fee_structures_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_structures_semester_id_fkey";
            columns: ["semester_id"];
            isOneToOne: false;
            referencedRelation: "semesters";
            referencedColumns: ["id"];
          },
        ];
      };
      fee_invoices: {
        Row: {
          amount_due: number;
          amount_paid: number;
          created_at: string;
          due_date: string;
          fee_structure_id: string;
          id: string;
          status: Database["public"]["Enums"]["invoice_status"];
          student_id: string;
          updated_at: string;
        };
        Insert: {
          amount_due: number;
          amount_paid?: number;
          created_at?: string;
          due_date: string;
          fee_structure_id: string;
          id?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          student_id: string;
          updated_at?: string;
        };
        Update: {
          amount_due?: number;
          amount_paid?: number;
          created_at?: string;
          due_date?: string;
          fee_structure_id?: string;
          id?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_invoices_fee_structure_id_fkey";
            columns: ["fee_structure_id"];
            isOneToOne: false;
            referencedRelation: "fee_structures";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_invoices_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      fee_payments: {
        Row: {
          amount: number;
          created_at: string;
          id: string;
          invoice_id: string;
          method: Database["public"]["Enums"]["payment_method"];
          notes: string | null;
          paid_at: string | null;
          razorpay_order_id: string | null;
          razorpay_payment_id: string | null;
          razorpay_signature: string | null;
          recorded_by: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          student_id: string;
        };
        Insert: {
          amount: number;
          created_at?: string;
          id?: string;
          invoice_id: string;
          method: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          paid_at?: string | null;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          razorpay_signature?: string | null;
          recorded_by?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          student_id: string;
        };
        Update: {
          amount?: number;
          created_at?: string;
          id?: string;
          invoice_id?: string;
          method?: Database["public"]["Enums"]["payment_method"];
          notes?: string | null;
          paid_at?: string | null;
          razorpay_order_id?: string | null;
          razorpay_payment_id?: string | null;
          razorpay_signature?: string | null;
          recorded_by?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fee_payments_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "fee_invoices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fee_payments_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      employees: {
        Row: {
          base_salary: number;
          created_at: string;
          date_joined: string;
          date_left: string | null;
          department_id: string | null;
          designation: string;
          display_name: string;
          employee_code: string;
          employment_type: Database["public"]["Enums"]["employment_type"];
          id: string;
          is_active: boolean;
          updated_at: string;
        };
        Insert: {
          base_salary?: number;
          created_at?: string;
          date_joined?: string;
          date_left?: string | null;
          department_id?: string | null;
          designation?: string;
          display_name: string;
          employee_code: string;
          employment_type?: Database["public"]["Enums"]["employment_type"];
          id: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Update: {
          base_salary?: number;
          created_at?: string;
          date_joined?: string;
          date_left?: string | null;
          department_id?: string | null;
          designation?: string;
          display_name?: string;
          employee_code?: string;
          employment_type?: Database["public"]["Enums"]["employment_type"];
          id?: string;
          is_active?: boolean;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
      payroll_runs: {
        Row: {
          created_at: string;
          created_by: string;
          finalized_at: string | null;
          id: string;
          period_month: number;
          period_year: number;
          status: Database["public"]["Enums"]["payroll_run_status"];
        };
        Insert: {
          created_at?: string;
          created_by: string;
          finalized_at?: string | null;
          id?: string;
          period_month: number;
          period_year: number;
          status?: Database["public"]["Enums"]["payroll_run_status"];
        };
        Update: {
          created_at?: string;
          created_by?: string;
          finalized_at?: string | null;
          id?: string;
          period_month?: number;
          period_year?: number;
          status?: Database["public"]["Enums"]["payroll_run_status"];
        };
        Relationships: [];
      };
      payslips: {
        Row: {
          allowances: number;
          basic_salary: number;
          created_at: string;
          deductions: number;
          employee_id: string;
          gross_pay: number;
          id: string;
          net_pay: number;
          notes: string | null;
          paid_at: string | null;
          payroll_run_id: string;
          status: Database["public"]["Enums"]["payslip_status"];
        };
        Insert: {
          allowances?: number;
          basic_salary: number;
          created_at?: string;
          deductions?: number;
          employee_id: string;
          gross_pay: number;
          id?: string;
          net_pay: number;
          notes?: string | null;
          paid_at?: string | null;
          payroll_run_id: string;
          status?: Database["public"]["Enums"]["payslip_status"];
        };
        Update: {
          allowances?: number;
          basic_salary?: number;
          created_at?: string;
          deductions?: number;
          employee_id?: string;
          gross_pay?: number;
          id?: string;
          net_pay?: number;
          notes?: string | null;
          paid_at?: string | null;
          payroll_run_id?: string;
          status?: Database["public"]["Enums"]["payslip_status"];
        };
        Relationships: [
          {
            foreignKeyName: "payslips_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payslips_payroll_run_id_fkey";
            columns: ["payroll_run_id"];
            isOneToOne: false;
            referencedRelation: "payroll_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_leave_requests: {
        Row: {
          approved_by: string | null;
          created_at: string;
          employee_id: string;
          end_date: string;
          id: string;
          leave_type: Database["public"]["Enums"]["staff_leave_type"];
          reason: string;
          reviewed_at: string | null;
          start_date: string;
          status: string;
        };
        Insert: {
          approved_by?: string | null;
          created_at?: string;
          employee_id: string;
          end_date: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["staff_leave_type"];
          reason: string;
          reviewed_at?: string | null;
          start_date: string;
          status?: string;
        };
        Update: {
          approved_by?: string | null;
          created_at?: string;
          employee_id?: string;
          end_date?: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["staff_leave_type"];
          reason?: string;
          reviewed_at?: string | null;
          start_date?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_leave_requests_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      enrollment_photos: {
        Row: {
          algo: string;
          ciphertext: string;
          created_at: string;
          id: string;
          student_id: string;
          updated_at: string;
        };
        Insert: {
          algo?: string;
          ciphertext: string;
          created_at?: string;
          id?: string;
          student_id: string;
          updated_at?: string;
        };
        Update: {
          algo?: string;
          ciphertext?: string;
          created_at?: string;
          id?: string;
          student_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      spot_check_requests: {
        Row: {
          action: string;
          created_at: string;
          expires_at: string;
          id: string;
          issued_at: string;
          session_id: string;
          session_id_token: string;
          status: string;
          student_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          expires_at: string;
          id?: string;
          issued_at?: string;
          session_id: string;
          session_id_token: string;
          status?: string;
          student_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          expires_at?: string;
          id?: string;
          issued_at?: string;
          session_id?: string;
          session_id_token?: string;
          status?: string;
          student_id?: string;
        };
        Relationships: [];
      };
      webauthn_exemptions: {
        Row: {
          created_at: string;
          expires_at: string | null;
          granted_by: string;
          id: string;
          reason: string;
          revoked_at: string | null;
          student_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string | null;
          granted_by: string;
          id?: string;
          reason: string;
          revoked_at?: string | null;
          student_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string | null;
          granted_by?: string;
          id?: string;
          reason?: string;
          revoked_at?: string | null;
          student_id?: string;
        };
        Relationships: [];
      };
      face_embeddings: {
        Row: {
          algo: string;
          ciphertext: string;
          created_at: string;
          id: string;
          student_id: string;
        };
        Insert: {
          algo?: string;
          ciphertext: string;
          created_at?: string;
          id?: string;
          student_id: string;
        };
        Update: {
          algo?: string;
          ciphertext?: string;
          created_at?: string;
          id?: string;
          student_id?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          current_semester: number | null;
          department_id: string | null;
          display_name: string | null;
          program_id: string | null;
          roll_no: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          current_semester?: number | null;
          department_id?: string | null;
          display_name?: string | null;
          program_id?: string | null;
          roll_no?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          current_semester?: number | null;
          department_id?: string | null;
          display_name?: string | null;
          program_id?: string | null;
          roll_no?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
        ];
      };
      programs: {
        Row: {
          code: string;
          created_at: string;
          department_id: string;
          duration_semesters: number;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          department_id: string;
          duration_semesters?: number;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          department_id?: string;
          duration_semesters?: number;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "programs_department_id_fkey";
            columns: ["department_id"];
            isOneToOne: false;
            referencedRelation: "departments";
            referencedColumns: ["id"];
          },
        ];
      };
      semesters: {
        Row: {
          code: string;
          created_at: string;
          ends_on: string;
          id: string;
          is_active: boolean;
          name: string;
          starts_on: string;
          updated_at: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          ends_on: string;
          id?: string;
          is_active?: boolean;
          name: string;
          starts_on: string;
          updated_at?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          ends_on?: string;
          id?: string;
          is_active?: boolean;
          name?: string;
          starts_on?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      role_requests: {
        Row: {
          created_at: string;
          id: string;
          reason: string | null;
          requested_role: Database["public"]["Enums"]["app_role"];
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          reason?: string | null;
          requested_role: Database["public"]["Enums"]["app_role"];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          reason?: string | null;
          requested_role?: Database["public"]["Enums"]["app_role"];
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_requests_user_id_profiles_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      fallback_requests: {
        Row: {
          created_at: string;
          id: string;
          reason: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          session_id: string;
          status: string;
          student_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          reason: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          session_id: string;
          status?: string;
          student_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          reason?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          session_id?: string;
          status?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fallback_requests_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "class_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fallback_requests_student_id_profiles_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      timetable: {
        Row: {
          course_id: string;
          created_at: string;
          day_of_week: number;
          effective_from: string;
          effective_until: string | null;
          end_time: string;
          id: string;
          room: string | null;
          start_time: string;
          updated_at: string;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          day_of_week: number;
          effective_from?: string;
          effective_until?: string | null;
          end_time: string;
          id?: string;
          room?: string | null;
          start_time: string;
          updated_at?: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          day_of_week?: number;
          effective_from?: string;
          effective_until?: string | null;
          end_time?: string;
          id?: string;
          room?: string | null;
          start_time?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "timetable_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      leave_requests: {
        Row: {
          approved_by: string | null;
          created_at: string;
          document_url: string | null;
          document_verified: boolean;
          end_date: string;
          id: string;
          leave_type: Database["public"]["Enums"]["leave_type"];
          reason: string;
          rejection_reason: string | null;
          request_type: string;
          reviewed_at: string | null;
          start_date: string;
          status: string;
          student_id: string;
          verified_by: string | null;
        };
        Insert: {
          approved_by?: string | null;
          created_at?: string;
          document_url?: string | null;
          document_verified?: boolean;
          end_date: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["leave_type"];
          reason: string;
          rejection_reason?: string | null;
          request_type?: string;
          reviewed_at?: string | null;
          start_date: string;
          status?: string;
          student_id: string;
          verified_by?: string | null;
        };
        Update: {
          approved_by?: string | null;
          created_at?: string;
          document_url?: string | null;
          document_verified?: boolean;
          end_date?: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["leave_type"];
          reason?: string;
          rejection_reason?: string | null;
          request_type?: string;
          reviewed_at?: string | null;
          start_date?: string;
          status?: string;
          student_id?: string;
          verified_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "leave_requests_student_id_profiles_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      leave_approval_rules: {
        Row: {
          approval_chain: string[];
          created_at: string;
          id: string;
          leave_type: string;
          max_days: number | null;
          min_days: number;
        };
        Insert: {
          approval_chain?: string[];
          created_at?: string;
          id?: string;
          leave_type: string;
          max_days?: number | null;
          min_days?: number;
        };
        Update: {
          approval_chain?: string[];
          created_at?: string;
          id?: string;
          leave_type?: string;
          max_days?: number | null;
          min_days?: number;
        };
        Relationships: [];
      };
      approver_delegations: {
        Row: {
          approver_id: string;
          created_at: string;
          delegate_id: string;
          ends_at: string;
          id: string;
          is_active: boolean;
          starts_at: string;
        };
        Insert: {
          approver_id: string;
          created_at?: string;
          delegate_id: string;
          ends_at: string;
          id?: string;
          is_active?: boolean;
          starts_at: string;
        };
        Update: {
          approver_id?: string;
          created_at?: string;
          delegate_id?: string;
          ends_at?: string;
          id?: string;
          is_active?: boolean;
          starts_at?: string;
        };
        Relationships: [];
      };
      user_notification_preferences: {
        Row: {
          email_enabled: boolean;
          in_app_enabled: boolean;
          phone_number: string | null;
          sms_enabled: boolean;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          email_enabled?: boolean;
          in_app_enabled?: boolean;
          phone_number?: string | null;
          sms_enabled?: boolean;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          email_enabled?: boolean;
          in_app_enabled?: boolean;
          phone_number?: string | null;
          sms_enabled?: boolean;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      user_sessions: {
        Row: {
          created_at: string;
          device_info: string;
          id: string;
          ip_address: string | null;
          last_active_at: string;
          revoked_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          device_info: string;
          id?: string;
          ip_address?: string | null;
          last_active_at?: string;
          revoked_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          device_info?: string;
          id?: string;
          ip_address?: string | null;
          last_active_at?: string;
          revoked_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      feature_flags: {
        Row: {
          description: string | null;
          is_enabled: boolean;
          key: string;
          updated_at: string;
        };
        Insert: {
          description?: string | null;
          is_enabled?: boolean;
          key: string;
          updated_at?: string;
        };
        Update: {
          description?: string | null;
          is_enabled?: boolean;
          key?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      report_subscriptions: {
        Row: {
          created_at: string;
          email: string;
          frequency: string;
          id: string;
          is_active: boolean;
          report_type: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          email: string;
          frequency?: string;
          id?: string;
          is_active?: boolean;
          report_type: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          frequency?: string;
          id?: string;
          is_active?: boolean;
          report_type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      analytics_refresh_log: {
        Row: {
          id: string;
          refreshed_at: string;
        };
        Insert: {
          id?: string;
          refreshed_at?: string;
        };
        Update: {
          id?: string;
          refreshed_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          id: string;
          target_id: string;
          target_table: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_id: string;
          target_table: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          target_id?: string;
          target_table?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      leave_balances: {
        Row: {
          academic_year: string;
          allocated: number;
          created_at: string;
          id: string;
          leave_type: Database["public"]["Enums"]["leave_type"];
          student_id: string;
          updated_at: string;
          used: number;
        };
        Insert: {
          academic_year?: string;
          allocated?: number;
          created_at?: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["leave_type"];
          student_id: string;
          updated_at?: string;
          used?: number;
        };
        Update: {
          academic_year?: string;
          allocated?: number;
          created_at?: string;
          id?: string;
          leave_type?: Database["public"]["Enums"]["leave_type"];
          student_id?: string;
          updated_at?: string;
          used?: number;
        };
        Relationships: [
          {
            foreignKeyName: "leave_balances_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      notifications: {
        Row: {
          created_at: string;
          id: string;
          message: string;
          metadata: Json;
          read: boolean;
          title: string;
          type: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          message: string;
          metadata?: Json;
          read?: boolean;
          title: string;
          type?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          message?: string;
          metadata?: Json;
          read?: boolean;
          title?: string;
          type?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      rate_limit_attempts: {
        Row: {
          attempted_at: string;
          id: string;
          key: string;
        };
        Insert: {
          attempted_at?: string;
          id?: string;
          key: string;
        };
        Update: {
          attempted_at?: string;
          id?: string;
          key?: string;
        };
        Relationships: [];
      };
      session_otp_secrets: {
        Row: {
          otp_generated_at: string | null;
          session_id: string;
          session_otp: string | null;
        };
        Insert: {
          otp_generated_at?: string | null;
          session_id: string;
          session_otp?: string | null;
        };
        Update: {
          otp_generated_at?: string | null;
          session_id?: string;
          session_otp?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "session_otp_secrets_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: true;
            referencedRelation: "class_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      webauthn_credentials: {
        Row: {
          id: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter: number;
          device_label: string | null;
          transports: string[] | null;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter?: number;
          device_label?: string | null;
          transports?: string[] | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          credential_id?: string;
          public_key?: string;
          counter?: number;
          device_label?: string | null;
          transports?: string[] | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      password_reset_tokens: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          expires_at: string;
          used_at: string | null;
          created_at: string;
          ip_address: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          token_hash: string;
          expires_at: string;
          used_at?: string | null;
          created_at?: string;
          ip_address?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          token_hash?: string;
          expires_at?: string;
          used_at?: string | null;
          created_at?: string;
          ip_address?: string | null;
        };
        Relationships: [];
      };
      liveness_sessions: {
        Row: {
          id: string;
          student_id: string;
          vendor_session_id: string;
          method: string;
          outcome: string;
          confidence: number | null;
          error_detail: string | null;
          created_at: string;
          resolved_at: string | null;
        };
        Insert: {
          id?: string;
          student_id: string;
          vendor_session_id: string;
          method?: string;
          outcome?: string;
          confidence?: number | null;
          error_detail?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Update: {
          id?: string;
          student_id?: string;
          vendor_session_id?: string;
          method?: string;
          outcome?: string;
          confidence?: number | null;
          error_detail?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "liveness_sessions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      mv_attendance_weekly: {
        Row: {
          attendance_pct: number;
          course_id: string;
          student_id: string;
          total_attended: number;
          total_held: number;
          week_start: string;
        };
        Insert: {
          attendance_pct?: number;
          course_id: string;
          student_id: string;
          total_attended?: number;
          total_held?: number;
          week_start?: string;
        };
        Update: {
          attendance_pct?: number;
          course_id?: string;
          student_id?: string;
          total_attended?: number;
          total_held?: number;
          week_start?: string;
        };
        Relationships: [];
      };
      mv_department_summary: {
        Row: {
          department_id: string;
          overall_attendance_pct: number;
          student_count: number;
          total_present: number;
          total_sessions: number;
        };
        Insert: {
          department_id: string;
          overall_attendance_pct?: number;
          student_count?: number;
          total_present?: number;
          total_sessions?: number;
        };
        Update: {
          department_id?: string;
          overall_attendance_pct?: number;
          student_count?: number;
          total_present?: number;
          total_sessions?: number;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      check_and_increment_rate_limit: {
        Args: {
          p_key: string;
          p_max_attempts: number;
          p_window_ms: number;
        };
        Returns: {
          allowed: boolean;
          current_count: number;
        }[];
      };
      enforce_biometric_retention: {
        Args: Record<PropertyKey, never>;
        Returns: {
          erased_count: number;
        }[];
      };
      refresh_analytics_views: {
        Args: Record<PropertyKey, never>;
        Returns: void;
      };
    };
    Enums: {
      app_role: "admin" | "teacher" | "student";
      attendance_decision: "present" | "review" | "rejected" | "fallback_present";
      exam_type: "quiz" | "midterm" | "end_semester" | "practical" | "assignment";
      fee_category: "tuition" | "hostel" | "exam" | "library" | "transport" | "misc";
      invoice_status: "pending" | "partial" | "paid" | "overdue" | "waived";
      payment_method: "razorpay" | "cash" | "cheque" | "bank_transfer";
      payment_status: "created" | "success" | "failed" | "refunded";
      employment_type: "full_time" | "part_time" | "contract";
      payroll_run_status: "draft" | "finalized" | "paid";
      payslip_status: "pending" | "paid";
      staff_leave_type: "casual" | "sick" | "earned" | "unpaid";
      leave_type: "casual" | "medical" | "duty" | "other";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "teacher", "student"],
      attendance_decision: ["present", "review", "rejected", "fallback_present"],
      exam_type: ["quiz", "midterm", "end_semester", "practical", "assignment"],
      fee_category: ["tuition", "hostel", "exam", "library", "transport", "misc"],
      invoice_status: ["pending", "partial", "paid", "overdue", "waived"],
      payment_method: ["razorpay", "cash", "cheque", "bank_transfer"],
      payment_status: ["created", "success", "failed", "refunded"],
      employment_type: ["full_time", "part_time", "contract"],
      payroll_run_status: ["draft", "finalized", "paid"],
      payslip_status: ["pending", "paid"],
      staff_leave_type: ["casual", "sick", "earned", "unpaid"],
    },
  },
} as const;

// ── Phase 5 table types (added separately to avoid touching generated types) ──

export interface LivenessSessionRow {
  id: string;
  student_id: string;
  vendor_session_id: string;
  method: "rekognition" | "webauthn_bypass" | "hmac_fallback";
  outcome: "pending" | "passed" | "failed" | "error";
  confidence: number | null;
  error_detail: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface KeyRotationJobRow {
  id: string;
  operator_id: string | null;
  target_version: number;
  started_at: string;
  completed_at: string | null;
  rows_processed: number;
  rows_remaining: number;
  error_count: number;
  status: "running" | "completed" | "failed" | "partial";
}

export interface HardwareCheckinRow {
  id: string;
  student_id: string;
  session_id: string | null;
  hardware_type: "fingerprint" | "rfid" | "nfc";
  reader_id: string;
  checkin_at: string;
  raw_payload: Json;
  verified: boolean;
  error_detail: string | null;
}
