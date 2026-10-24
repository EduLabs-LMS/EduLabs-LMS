export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      academic_subjects: {
        Row: {
          created_at: string
          id: string
          label: string
          label_key: string
          organization_id: string
          position: number
          revision: number
          slug: string
          status: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "academic_subjects_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_programs: {
        Row: {
          created_at: string
          description: string | null
          examination_board: string | null
          id: string
          label: string
          organization_id: string
          position: number
          revision: number
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          examination_board?: string | null
          id?: string
          label: string
          organization_id: string
          position?: number
          revision?: number
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          examination_board?: string | null
          id?: string
          label?: string
          organization_id?: string
          position?: number
          revision?: number
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_programs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_stages: {
        Row: {
          created_at: string
          description: string | null
          id: string
          label: string
          organization_id: string
          position: number
          program_id: string
          revision: number
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          label: string
          organization_id: string
          position?: number
          program_id: string
          revision?: number
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          label?: string
          organization_id?: string
          position?: number
          program_id?: string
          revision?: number
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_stages_organization_id_program_id_fkey"
            columns: ["organization_id", "program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      course_stage_assignments: {
        Row: {
          course_id: string
          created_at: string
          organization_id: string
          stage_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          organization_id: string
          stage_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          organization_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_stage_assignments_organization_id_course_id_fkey"
            columns: ["organization_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "course_stage_assignments_organization_id_stage_id_fkey"
            columns: ["organization_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "academic_stages"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      student_stage_preferences: {
        Row: {
          created_at: string
          organization_id: string
          program_id: string
          revision: number
          stage_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          program_id: string
          revision?: number
          stage_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          program_id?: string
          revision?: number
          stage_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "student_stage_preferences_organization_id_program_id_fkey"
            columns: ["organization_id", "program_id"]
            isOneToOne: false
            referencedRelation: "academic_programs"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "student_stage_preferences_organization_id_program_id_stage_fkey"
            columns: ["organization_id", "program_id", "stage_id"]
            isOneToOne: false
            referencedRelation: "academic_stages"
            referencedColumns: ["organization_id", "program_id", "id"]
          },
          {
            foreignKeyName: "student_stage_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      account_profiles: {
        Row: { user_id: string; first_name: string; last_name: string; avatar_id: string | null; onboarding_completed_at: string | null; revision: number; updated_at: string }
        Insert: { user_id: string; first_name?: string; last_name?: string; avatar_id?: string | null; onboarding_completed_at?: string | null; revision?: number; updated_at?: string }
        Update: { user_id?: string; first_name?: string; last_name?: string; avatar_id?: string | null; onboarding_completed_at?: string | null; revision?: number; updated_at?: string }
        Relationships: [{ foreignKeyName: "account_profiles_user_id_fkey"; columns: ["user_id"]; isOneToOne: true; referencedRelation: "profiles"; referencedColumns: ["id"] }]
      }
      enrollment_requests: {
        Row: {
          id: string
          offering_id: string
          user_id: string
          status: string
          version: number
          reason: string
          reviewed_by: string | null
          reviewed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          offering_id: string
          user_id: string
          status?: string
          version?: number
          reason?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          offering_id?: string
          user_id?: string
          status?: string
          version?: number
          reason?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [{"foreignKeyName":"enrollment_requests_offering_id_fkey","columns":["offering_id"],"isOneToOne":false,"referencedRelation":"course_offerings","referencedColumns":["id"]},{"foreignKeyName":"enrollment_requests_reviewed_by_fkey","columns":["reviewed_by"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]},{"foreignKeyName":"enrollment_requests_user_id_fkey","columns":["user_id"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]}]
      }


      support_tickets: {
        Row: {
          id: string
          organization_id: string | null
          requester_id: string
          category: string
          subject: string
          status: string
          assigned_to: string | null
          version: number
          created_at: string
          updated_at: string
          last_message_at: string
          response_due_at: string | null
          first_staff_response_at: string | null
        }
        Insert: {
          id?: string
          organization_id?: string | null
          requester_id: string
          category: string
          subject: string
          status?: string
          assigned_to?: string | null
          version?: number
          created_at?: string
          updated_at?: string
          last_message_at?: string
          response_due_at?: string | null
          first_staff_response_at?: string | null
        }
        Update: {
          id?: string
          organization_id?: string | null
          requester_id?: string
          category?: string
          subject?: string
          status?: string
          assigned_to?: string | null
          version?: number
          created_at?: string
          updated_at?: string
          last_message_at?: string
          response_due_at?: string | null
          first_staff_response_at?: string | null
        }
        Relationships: [{"foreignKeyName":"support_tickets_assigned_to_fkey","columns":["assigned_to"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]},{"foreignKeyName":"support_tickets_organization_id_fkey","columns":["organization_id"],"isOneToOne":false,"referencedRelation":"organizations","referencedColumns":["id"]},{"foreignKeyName":"support_tickets_requester_id_fkey","columns":["requester_id"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]}]
      }
      support_messages: {
        Row: {
          id: string
          ticket_id: string
          sender_id: string
          staff: boolean
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          ticket_id: string
          sender_id: string
          staff: boolean
          body: string
          created_at?: string
        }
        Update: {
          id?: string
          ticket_id?: string
          sender_id?: string
          staff?: boolean
          body?: string
          created_at?: string
        }
        Relationships: [{"foreignKeyName":"support_messages_sender_id_fkey","columns":["sender_id"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]},{"foreignKeyName":"support_messages_ticket_id_fkey","columns":["ticket_id"],"isOneToOne":false,"referencedRelation":"support_tickets","referencedColumns":["id"]}]
      }
      notifications: {
        Row: {
          id: string
          event_id: string
          recipient_id: string
          event_type: string
          in_app: boolean
          created_at: string
          read_at: string | null
        }
        Insert: {
          id?: string
          event_id: string
          recipient_id: string
          event_type: string
          in_app?: boolean
          created_at?: string
          read_at?: string | null
        }
        Update: {
          id?: string
          event_id?: string
          recipient_id?: string
          event_type?: string
          in_app?: boolean
          created_at?: string
          read_at?: string | null
        }
        Relationships: [{"foreignKeyName":"notifications_event_id_fkey","columns":["event_id"],"isOneToOne":false,"referencedRelation":"notification_events","referencedColumns":["id"]},{"foreignKeyName":"notifications_recipient_id_fkey","columns":["recipient_id"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]}]
      }
      notification_preferences: {
        Row: {
          user_id: string
          event_type: string
          in_app: boolean
          push: boolean
          updated_at: string
        }
        Insert: {
          user_id: string
          event_type: string
          in_app?: boolean
          push?: boolean
          updated_at?: string
        }
        Update: {
          user_id?: string
          event_type?: string
          in_app?: boolean
          push?: boolean
          updated_at?: string
        }
        Relationships: [{"foreignKeyName":"notification_preferences_user_id_fkey","columns":["user_id"],"isOneToOne":false,"referencedRelation":"profiles","referencedColumns":["id"]}]
      }


      assessment_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          deadline_at: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          max_score: number | null
          offering_assessment_id: string
          participation_id: string | null
          score: number | null
          started_at: string
          status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          deadline_at?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          max_score?: number | null
          offering_assessment_id: string
          participation_id?: string | null
          score?: number | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          deadline_at?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          max_score?: number | null
          offering_assessment_id?: string
          participation_id?: string | null
          score?: number | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_attempts_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_attempts_offering_assessment_id_fkey"
            columns: ["offering_assessment_id"]
            isOneToOne: false
            referencedRelation: "offering_assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_attempts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_options: {
        Row: {
          created_at: string
          id: string
          is_correct: boolean
          position: number
          question_id: string
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_correct?: boolean
          position: number
          question_id: string
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_correct?: boolean
          position?: number
          question_id?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "assessment_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_questions: {
        Row: {
          assessment_id: string
          created_at: string
          id: string
          points: number
          position: number
          prompt: string
          question_type: string
          settings: Json
          updated_at: string
        }
        Insert: {
          assessment_id: string
          created_at?: string
          id?: string
          points?: number
          position: number
          prompt: string
          question_type: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          created_at?: string
          id?: string
          points?: number
          position?: number
          prompt?: string
          question_type?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_questions_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      assessment_responses: {
        Row: {
          attempt_id: string
          awarded_points: number | null
          created_at: string
          feedback: string | null
          graded_at: string | null
          graded_by: string | null
          id: string
          media_asset_id: string | null
          question_id: string
          response: Json
          updated_at: string
        }
        Insert: {
          attempt_id: string
          awarded_points?: number | null
          created_at?: string
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          media_asset_id?: string | null
          question_id: string
          response?: Json
          updated_at?: string
        }
        Update: {
          attempt_id?: string
          awarded_points?: number | null
          created_at?: string
          feedback?: string | null
          graded_at?: string | null
          graded_by?: string | null
          id?: string
          media_asset_id?: string | null
          question_id?: string
          response?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assessment_responses_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "assessment_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_responses_graded_by_fkey"
            columns: ["graded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_responses_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessment_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "assessment_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      assessments: {
        Row: {
          course_id: string
          created_at: string
          created_by: string | null
          id: string
          instructions: string | null
          status: string
          supersedes_assessment_id: string | null
          title: string
          type: string
          updated_at: string
          version: number
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          instructions?: string | null
          status?: string
          supersedes_assessment_id?: string | null
          title: string
          type: string
          updated_at?: string
          version?: number
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          instructions?: string | null
          status?: string
          supersedes_assessment_id?: string | null
          title?: string
          type?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "assessments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assessments_supersedes_assessment_id_fkey"
            columns: ["supersedes_assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
        ]
      }
      course_modules: {
        Row: {
          chapter_number: number | null
          summary: string
          course_id: string
          created_at: string
          description: string | null
          group_type: string
          id: string
          position: number
          title: string
          updated_at: string
        }
        Insert: {
          chapter_number?: number | null
          summary?: string
          course_id: string
          created_at?: string
          description?: string | null
          group_type?: string
          id?: string
          position: number
          title: string
          updated_at?: string
        }
        Update: {
          chapter_number?: number | null
          summary?: string
          course_id?: string
          created_at?: string
          description?: string | null
          group_type?: string
          id?: string
          position?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_offerings: {
        Row: {
          capacity: number | null
          course_id: string
          created_at: string
          delivery_mode: string
          ends_at: string | null
          enrollment_closes_at: string | null
          enrollment_opens_at: string | null
          id: string
          name: string
          starts_at: string | null
          status: string
          timezone: string
          updated_at: string
        }
        Insert: {
          capacity?: number | null
          course_id: string
          created_at?: string
          delivery_mode?: string
          ends_at?: string | null
          enrollment_closes_at?: string | null
          enrollment_opens_at?: string | null
          id?: string
          name: string
          starts_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          capacity?: number | null
          course_id?: string
          created_at?: string
          delivery_mode?: string
          ends_at?: string | null
          enrollment_closes_at?: string | null
          enrollment_opens_at?: string | null
          id?: string
          name?: string
          starts_at?: string | null
          status?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_offerings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_staff: {
        Row: {
          course_id: string
          created_at: string
          id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_staff_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          organization_id: string
          slug: string
          subject_id: string | null
          status: string
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          organization_id: string
          slug: string
          subject_id?: string | null
          status?: string
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          organization_id?: string
          slug?: string
          subject_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          enrolled_at: string | null
          expires_at: string | null
          id: string
          offering_id: string
          source: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          enrolled_at?: string | null
          expires_at?: string | null
          id?: string
          offering_id: string
          source?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          enrolled_at?: string | null
          expires_at?: string | null
          id?: string
          offering_id?: string
          source?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_memberships: {
        Row: {
          created_at: string
          created_by: string
          ends_at: string | null
          enrollment_expires_at: string | null
          enrollment_id: string
          group_id: string
          id: string
          offering_id: string
          starts_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          ends_at?: string | null
          enrollment_expires_at?: string | null
          enrollment_id: string
          group_id: string
          id?: string
          offering_id: string
          starts_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          ends_at?: string | null
          enrollment_expires_at?: string | null
          enrollment_id?: string
          group_id?: string
          id?: string
          offering_id?: string
          starts_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_memberships_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_memberships_group_id_offering_id_fkey"
            columns: ["group_id", "offering_id"]
            isOneToOne: false
            referencedRelation: "study_groups"
            referencedColumns: ["id", "offering_id"]
          },
          {
            foreignKeyName: "group_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_schedules: {
        Row: {
          active: boolean
          created_at: string
          duration_minutes: number
          group_id: string
          id: string
          local_time: string
          materialized_through: string
          weekday: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          duration_minutes: number
          group_id: string
          id?: string
          local_time: string
          materialized_through?: string
          weekday: number
        }
        Update: {
          active?: boolean
          created_at?: string
          duration_minutes?: number
          group_id?: string
          id?: string
          local_time?: string
          materialized_through?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_schedules_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "study_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      group_sessions: {
        Row: {
          attendance_state: string
          cancellation_reason: string
          cancelled: boolean
          created_at: string
          created_by: string
          ends_at: string
          exception: boolean
          group_id: string
          id: string
          instructions: string
          join_url: string
          location: string
          mode: string
          occurrence_date: string | null
          original_ends_at: string
          original_starts_at: string
          roster_at: string | null
          schedule_id: string | null
          starts_at: string
          title: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          attendance_state?: string
          cancellation_reason?: string
          cancelled?: boolean
          created_at?: string
          created_by: string
          ends_at: string
          exception?: boolean
          group_id: string
          id?: string
          instructions?: string
          join_url?: string
          location?: string
          mode: string
          occurrence_date?: string | null
          original_ends_at: string
          original_starts_at: string
          roster_at?: string | null
          schedule_id?: string | null
          starts_at: string
          title: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          attendance_state?: string
          cancellation_reason?: string
          cancelled?: boolean
          created_at?: string
          created_by?: string
          ends_at?: string
          exception?: boolean
          group_id?: string
          id?: string
          instructions?: string
          join_url?: string
          location?: string
          mode?: string
          occurrence_date?: string | null
          original_ends_at?: string
          original_starts_at?: string
          roster_at?: string | null
          schedule_id?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "group_sessions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_sessions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "study_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_sessions_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "group_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_sessions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      group_staff: {
        Row: {
          created_at: string
          group_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_staff_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "study_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "group_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_assignments: {
        Row: {
          course_id: string
          created_at: string
          created_by: string
          family_id: string
          file_points: number
          id: string
          instructions: string
          lesson_id: string
          mode: string
          offering_id: string
          revision: number
          segment_id: string | null
          status: string
          supersedes_id: string | null
          title: string
          updated_at: string
          uses_marks: boolean
          version: number
        }
        Insert: {
          course_id: string
          created_at?: string
          created_by: string
          family_id: string
          file_points?: number
          id?: string
          instructions?: string
          lesson_id: string
          mode?: string
          offering_id: string
          revision?: number
          segment_id?: string | null
          status?: string
          supersedes_id?: string | null
          title: string
          updated_at?: string
          uses_marks?: boolean
          version?: number
        }
        Update: {
          course_id?: string
          created_at?: string
          created_by?: string
          family_id?: string
          file_points?: number
          id?: string
          instructions?: string
          lesson_id?: string
          mode?: string
          offering_id?: string
          revision?: number
          segment_id?: string | null
          status?: string
          supersedes_id?: string | null
          title?: string
          updated_at?: string
          uses_marks?: boolean
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "homework_assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "lesson_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_assignments_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_options: {
        Row: {
          id: string
          position: number
          question_id: string
          text: string
        }
        Insert: {
          id: string
          position: number
          question_id: string
          text?: string
        }
        Update: {
          id?: string
          position?: number
          question_id?: string
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "homework_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_questions: {
        Row: {
          assignment_id: string
          id: string
          image_id: string | null
          points: number
          position: number
          response_mode: string
          text: string
          type: string
        }
        Insert: {
          assignment_id: string
          id: string
          image_id?: string | null
          points: number
          position: number
          response_mode: string
          text?: string
          type: string
        }
        Update: {
          assignment_id?: string
          id?: string
          image_id?: string | null
          points?: number
          position?: number
          response_mode?: string
          text?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_questions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_responses: {
        Row: {
          id: string
          question_id: string
          response: Json
          submission_id: string
        }
        Insert: {
          id?: string
          question_id: string
          response?: Json
          submission_id: string
        }
        Update: {
          id?: string
          question_id?: string
          response?: Json
          submission_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "homework_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_responses_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "homework_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submission_files: {
        Row: {
          id: string
          question_id: string | null
          submission_id: string
          upload_id: string
        }
        Insert: {
          id?: string
          question_id?: string | null
          submission_id: string
          upload_id: string
        }
        Update: {
          id?: string
          question_id?: string | null
          submission_id?: string
          upload_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submission_files_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "homework_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submission_files_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "homework_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      homework_submissions: {
        Row: {
          assignment_id: string
          created_at: string
          id: string
          number: number
          revision: number
          status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          assignment_id: string
          created_at?: string
          id?: string
          number: number
          revision?: number
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          assignment_id?: string
          created_at?: string
          id?: string
          number?: number
          revision?: number
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "homework_submissions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "homework_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "homework_submissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_blocks: {
        Row: {
          block_type: string
          content: Json
          created_at: string
          id: string
          lesson_id: string
          media_asset_id: string | null
          position: number
          updated_at: string
        }
        Insert: {
          block_type: string
          content?: Json
          created_at?: string
          id?: string
          lesson_id: string
          media_asset_id?: string | null
          position: number
          updated_at?: string
        }
        Update: {
          block_type?: string
          content?: Json
          created_at?: string
          id?: string
          lesson_id?: string
          media_asset_id?: string | null
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_blocks_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_blocks_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_progress: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          last_accessed_at: string | null
          lesson_id: string
          offering_id: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
          video_position_seconds: number | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_accessed_at?: string | null
          lesson_id: string
          offering_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          video_position_seconds?: number | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          last_accessed_at?: string | null
          lesson_id?: string
          offering_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          video_position_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_progress_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_progress_offering_id_user_id_fkey"
            columns: ["offering_id", "user_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["offering_id", "user_id"]
          },
        ]
      }
      lesson_resources: {
        Row: {
          created_at: string
          id: string
          media_asset_id: string
          name: string
          segment_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_asset_id: string
          name: string
          segment_id: string
        }
        Update: {
          created_at?: string
          id?: string
          media_asset_id?: string
          name?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_resources_media_asset_id_fkey"
            columns: ["media_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_resources_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "lesson_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_segment_progress: {
        Row: {
          completed_at: string | null
          id: string
          lesson_id: string
          offering_id: string
          revision: number
          segment_id: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
          video_position_seconds: number
        }
        Insert: {
          completed_at?: string | null
          id?: string
          lesson_id: string
          offering_id: string
          revision?: number
          segment_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          video_position_seconds?: number
        }
        Update: {
          completed_at?: string | null
          id?: string
          lesson_id?: string
          offering_id?: string
          revision?: number
          segment_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          video_position_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "lesson_segment_progress_offering_id_user_id_fkey"
            columns: ["offering_id", "user_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["offering_id", "user_id"]
          },
          {
            foreignKeyName: "lesson_segment_progress_segment_id_lesson_id_fkey"
            columns: ["segment_id", "lesson_id"]
            isOneToOne: false
            referencedRelation: "lesson_segments"
            referencedColumns: ["id", "lesson_id"]
          },
        ]
      }
      lesson_segments: {
        Row: {
          created_at: string
          description: string
          id: string
          lesson_id: string
          position: number
          status: string
          thumbnail_asset_id: string | null
          title: string
          updated_at: string
          video_asset_id: string | null
          video_url: string | null
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          lesson_id: string
          position: number
          status?: string
          thumbnail_asset_id?: string | null
          title: string
          updated_at?: string
          video_asset_id?: string | null
          video_url?: string | null
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          lesson_id?: string
          position?: number
          status?: string
          thumbnail_asset_id?: string | null
          title?: string
          updated_at?: string
          video_asset_id?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lesson_segments_lesson_id_fkey"
            columns: ["lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_segments_thumbnail_asset_id_fkey"
            columns: ["thumbnail_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_segments_video_asset_id_fkey"
            columns: ["video_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          cover_asset_id: string | null
          created_at: string
          description: string
          estimated_duration_seconds: number | null
          id: string
          module_id: string
          position: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          cover_asset_id?: string | null
          created_at?: string
          description?: string
          estimated_duration_seconds?: number | null
          id?: string
          module_id: string
          position: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          cover_asset_id?: string | null
          created_at?: string
          description?: string
          estimated_duration_seconds?: number | null
          id?: string
          module_id?: string
          position?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_cover_asset_id_fkey"
            columns: ["cover_asset_id"]
            isOneToOne: false
            referencedRelation: "media_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "course_modules"
            referencedColumns: ["id"]
          },
        ]
      }
      media_assets: {
        Row: {
          bucket: string
          created_at: string
          id: string
          kind: string
          mime_type: string
          object_path: string
          offering_id: string | null
          organization_id: string
          original_filename: string
          size_bytes: number | null
          status: string
          storage_provider: string
          updated_at: string
          upload_expires_at: string
          uploaded_by: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          kind: string
          mime_type: string
          object_path: string
          offering_id?: string | null
          organization_id: string
          original_filename: string
          size_bytes?: number | null
          status?: string
          storage_provider?: string
          updated_at?: string
          upload_expires_at?: string
          uploaded_by: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          kind?: string
          mime_type?: string
          object_path?: string
          offering_id?: string | null
          organization_id?: string
          original_filename?: string
          size_bytes?: number | null
          status?: string
          storage_provider?: string
          updated_at?: string
          upload_expires_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_assets_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      offering_assessments: {
        Row: {
          assessment_id: string
          closes_at: string | null
          created_at: string
          id: string
          max_attempts: number | null
          offering_id: string
          opens_at: string | null
          published: boolean
          shuffle_options: boolean
          shuffle_questions: boolean
          time_limit_seconds: number | null
          updated_at: string
        }
        Insert: {
          assessment_id: string
          closes_at?: string | null
          created_at?: string
          id?: string
          max_attempts?: number | null
          offering_id: string
          opens_at?: string | null
          published?: boolean
          shuffle_options?: boolean
          shuffle_questions?: boolean
          time_limit_seconds?: number | null
          updated_at?: string
        }
        Update: {
          assessment_id?: string
          closes_at?: string | null
          created_at?: string
          id?: string
          max_attempts?: number | null
          offering_id?: string
          opens_at?: string | null
          published?: boolean
          shuffle_options?: boolean
          shuffle_questions?: boolean
          time_limit_seconds?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offering_assessments_assessment_id_fkey"
            columns: ["assessment_id"]
            isOneToOne: false
            referencedRelation: "assessments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offering_assessments_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
        ]
      }
      offering_staff: {
        Row: {
          created_at: string
          id: string
          offering_id: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          offering_id: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          offering_id?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "offering_staff_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offering_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          created_at: string
          id: string
          joined_at: string | null
          organization_id: string
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          joined_at?: string | null
          organization_id: string
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          joined_at?: string | null
          organization_id?: string
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_path?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      session_attendance: {
        Row: {
          membership_id: string
          session_id: string
          status: string
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          membership_id: string
          session_id: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          membership_id?: string
          session_id?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_attendance_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "group_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "group_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_attendance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      study_groups: {
        Row: {
          stream_label: string
          stream_icon: string
          capacity: number | null
          created_at: string
          created_by: string
          description: string
          id: string
          instructions: string
          join_url: string
          location: string
          mode: string
          name: string
          offering_id: string
          status: string
          timezone: string
          updated_at: string
          version: number
        }
        Insert: {
          stream_label?: string
          stream_icon?: string
          capacity?: number | null
          created_at?: string
          created_by: string
          description?: string
          id?: string
          instructions?: string
          join_url?: string
          location?: string
          mode: string
          name: string
          offering_id: string
          status?: string
          timezone?: string
          updated_at?: string
          version?: number
        }
        Update: {
          stream_label?: string
          stream_icon?: string
          capacity?: number | null
          created_at?: string
          created_by?: string
          description?: string
          id?: string
          instructions?: string
          join_url?: string
          location?: string
          mode?: string
          name?: string
          offering_id?: string
          status?: string
          timezone?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "study_groups_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_groups_offering_id_fkey"
            columns: ["offering_id"]
            isOneToOne: false
            referencedRelation: "course_offerings"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_platform_admin: { Args: never; Returns: boolean }
      platform_provision_teacher: { Args: { p_request: Json; p_token_hash: string }; Returns: Json }
      platform_reissue_teacher_invitation: { Args: { p_organization_id: string; p_token_hash: string; p_expires_in_days: number; p_email?: string | null }; Returns: Json }
      platform_revoke_teacher_invitation: { Args: { p_organization_id: string }; Returns: Json }
      accept_teacher_invitation: { Args: { p_token_hash: string }; Returns: Json }
      platform_portal_overview: { Args: { p_limit?: number }; Returns: Json }
      platform_portal_detail: { Args: { p_organization_id: string }; Returns: Json }
      academic_command: {
        Args: { p_action: string; p_organization_id: string; p_entity_id?: string; p_revision?: number; p_data?: Json }
        Returns: Json
      }
      course_stage_classification: { Args: { p_course_id: string }; Returns: Json }
      set_student_stage_preference: { Args: { p_program_id: string; p_stage_id: string | null; p_revision?: number }; Returns: Json }
      account_profile: { Args: { p_action: string; p_revision?: number | null; p_data?: Json }; Returns: Json }
      student_administration: { Args: { p_action: string; p_offering?: string | null; p_subject?: string | null; p_version?: number | null; p_request?: string | null; p_data?: Json }; Returns: Json }
      notification_command: { Args: { p_action: string; p_data?: Json }; Returns: Json }
      support_command: { Args: { p_action: string; p_ticket?: string | null; p_version?: number | null; p_request?: string | null; p_data?: Json }; Returns: Json }
      notification_worker: { Args: { p_action: string; p_data?: Json }; Returns: Json }
      abandon_media_upload: { Args: { p_asset_id: string }; Returns: undefined }
      archive_unused_lesson_upload: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      clone_assessment: {
        Args: { p_assessment_id: string; p_title?: string }
        Returns: string
      }
      clone_exam_schedule: { Args: { p_schedule_id: string }; Returns: string }
      complete_media_upload: {
        Args: { p_asset_id: string }
        Returns: undefined
      }
      create_organization: {
        Args: { p_name: string; p_slug: string }
        Returns: string
      }
      create_teacher_course: {
        Args: { p_organization_id: string; p_slug: string; p_title: string }
        Returns: string
      }
      current_profile_id: { Args: never; Returns: string }
      decide_exam_retry: {
        Args: {
          p_decision: string
          p_expected_revision: number
          p_schedule_id: string
        }
        Returns: Json
      }
      edit_learning_content: {
        Args: {
          p_action: string
          p_course_id: string
          p_data: Json
          p_id: string | null
          p_parent_id: string | null
          p_updated_at: string | null
        }
        Returns: string
      }
      finalize_assessment_grade: {
        Args: { p_attempt_id: string }
        Returns: undefined
      }
      get_assessment_answer_keys: {
        Args: { p_assessment_id: string }
        Returns: Json
      }
      get_assessment_results: { Args: { p_attempt_id: string }; Returns: Json }
      get_exam_attempt_content: {
        Args: { p_attempt_id: string }
        Returns: Json
      }
      get_exam_definition: { Args: { p_schedule_id: string }; Returns: Json }
      get_exam_definition_v2: { Args: { p_schedule_id: string }; Returns: Json }
      get_exam_grade_changes: { Args: { p_attempt_id: string }; Returns: Json }
      get_exam_grading_detail: { Args: { p_attempt_id: string }; Returns: Json }
      get_exam_review: { Args: { p_schedule_id: string }; Returns: Json }
      get_exam_submission_page: {
        Args: { p_after?: string | null; p_limit?: number; p_schedule_id: string }
        Returns: Json
      }
      get_exam_summaries: { Args: { p_schedule_ids: string[] }; Returns: Json }
      get_homework: {
        Args: { p_assignment: string; p_submission?: string | null }
        Returns: Json
      }
      get_lesson_upload: {
        Args: { p_asset_id: string; p_course_id: string }
        Returns: Json
      }
      grade_assessment_response: {
        Args: { p_feedback?: string; p_points: number; p_response_id: string }
        Returns: undefined
      }
      grade_exam_paper: {
        Args: {
          p_attempt_id: string
          p_expected_revision: number
          p_feedback: string
          p_reason: string | null
          p_request_id: string
          p_scores: Json
        }
        Returns: Json
      }
      group_command: {
        Args: {
          p_action: string
          p_data?: Json
          p_group: string | null
          p_version?: number | null
        }
        Returns: Json
      }
      group_view: {
        Args: {
          p_group?: string | null
          p_page?: number
          p_search?: string
          p_section?: string
        }
        Returns: Json
      }
      homework_history: {
        Args: { p_page?: number; p_submission: string }
        Returns: Json
      }
      homework_inbox: {
        Args: {
          p_assignment?: string | null
          p_offering: string
          p_page?: number
          p_search?: string
        }
        Returns: Json
      }
      homework_lifecycle: {
        Args: { p_action: string; p_assignment: string; p_revision: number }
        Returns: string
      }
      homework_revisions: {
        Args: { p_assignment: string; p_page?: number }
        Returns: Json
      }
      homework_upload: {
        Args: {
          p_action: string
          p_assignment: string
          p_data?: Json
          p_id?: string | null
          p_submission?: string | null
        }
        Returns: Json
      }
      homework_work: {
        Args: {
          p_action: string
          p_assignment: string
          p_data?: Json
          p_revision?: number | null
          p_submission?: string | null
        }
        Returns: Json
      }
      onboard_firebase_profile: { Args: never; Returns: string }
      register_lesson_upload: {
        Args: { p_course_id: string; p_filename: string; p_mime: string }
        Returns: Json
      }
      release_exam_result: {
        Args: {
          p_expected_revision: number
          p_schedule_id: string
          p_user_id: string
        }
        Returns: Json
      }
      release_exam_review: {
        Args: {
          p_expected_revision: number
          p_schedule_id: string
          p_user_id: string
        }
        Returns: Json
      }
      revoke_my_firebase_identity: { Args: never; Returns: undefined }
      save_assessment_response: {
        Args: {
          p_attempt_id: string
          p_media_asset_id?: string
          p_question_id: string
          p_response: Json
        }
        Returns: string
      }
      save_exam_answers: {
        Args: {
          p_answers: Json
          p_attempt_id: string
          p_expected_revision: number
        }
        Returns: Json
      }
      save_exam_definition: {
        Args: {
          p_definition: Json
          p_expected_updated_at: string | null
          p_offering_id: string
          p_schedule_id: string | null
        }
        Returns: string
      }
      save_exam_definition_v2: {
        Args: {
          p_definition: Json
          p_expected_updated_at: string | null
          p_offering_id: string
          p_schedule_id: string | null
        }
        Returns: string
      }
      save_exam_response: {
        Args: {
          p_attempt_id: string
          p_expected_revision: number
          p_media_asset_id: string | null
          p_question_id: string
          p_response: Json | null
        }
        Returns: Json
      }
      save_homework: {
        Args: {
          p_assignment: string | null
          p_confirm_mode_change?: boolean
          p_definition: Json
          p_lesson: string
          p_offering: string
          p_revision: number | null
          p_segment: string | null
        }
        Returns: string
      }
      save_segment_progress: {
        Args: {
          p_complete: boolean
          p_offering_id: string
          p_position: number
          p_revision: number
          p_segment_id: string
        }
        Returns: Json
      }
      set_assessment_answer_key: {
        Args: { p_answer: Json; p_question_id: string }
        Returns: undefined
      }
      start_assessment_attempt: {
        Args: { p_offering_assessment_id: string }
        Returns: string
      }
      submit_assessment_attempt: {
        Args: { p_attempt_id: string }
        Returns: undefined
      }
      sync_exam_participation: {
        Args: { p_schedule_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
