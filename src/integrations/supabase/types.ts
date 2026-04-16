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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_models: {
        Row: {
          created_at: string | null
          display_name: string | null
          id: string
          is_active: boolean | null
          model_key: string
          tier: string | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          model_key: string
          tier?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          id?: string
          is_active?: boolean | null
          model_key?: string
          tier?: string | null
        }
        Relationships: []
      }
      analytics_logs: {
        Row: {
          created_at: string
          id: string
          project_id: string
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          url?: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          url?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          api_key: string
          created_at: string | null
          id: string
          is_valid: boolean | null
          label: string | null
          last_checked_at: string | null
          provider: string
          updated_at: string | null
        }
        Insert: {
          api_key: string
          created_at?: string | null
          id?: string
          is_valid?: boolean | null
          label?: string | null
          last_checked_at?: string | null
          provider: string
          updated_at?: string | null
        }
        Update: {
          api_key?: string
          created_at?: string | null
          id?: string
          is_valid?: boolean | null
          label?: string | null
          last_checked_at?: string | null
          provider?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          description: string | null
          id: string
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          description?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value?: string
        }
        Update: {
          description?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      article_metrics: {
        Row: {
          article_id: string
          character_count: number | null
          content_score: number | null
          h2_count: number | null
          h3_count: number | null
          id: string
          images_count: number | null
          is_description_optimal: boolean | null
          is_title_optimal: boolean | null
          keyword_density: number | null
          lsi_covered_count: number | null
          reading_time_minutes: number | null
          schema_json: Json | null
          updated_at: string | null
          word_count: number | null
        }
        Insert: {
          article_id: string
          character_count?: number | null
          content_score?: number | null
          h2_count?: number | null
          h3_count?: number | null
          id?: string
          images_count?: number | null
          is_description_optimal?: boolean | null
          is_title_optimal?: boolean | null
          keyword_density?: number | null
          lsi_covered_count?: number | null
          reading_time_minutes?: number | null
          schema_json?: Json | null
          updated_at?: string | null
          word_count?: number | null
        }
        Update: {
          article_id?: string
          character_count?: number | null
          content_score?: number | null
          h2_count?: number | null
          h3_count?: number | null
          id?: string
          images_count?: number | null
          is_description_optimal?: boolean | null
          is_title_optimal?: boolean | null
          keyword_density?: number | null
          lsi_covered_count?: number | null
          reading_time_minutes?: number | null
          schema_json?: Json | null
          updated_at?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "article_metrics_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_metrics_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_telegraph_tokens: {
        Row: {
          access_token: string
          article_id: string
          created_at: string | null
        }
        Insert: {
          access_token: string
          article_id: string
          created_at?: string | null
        }
        Update: {
          access_token?: string
          article_id?: string
          created_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "article_telegraph_tokens_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: true
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_telegraph_tokens_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: true
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      article_versions: {
        Row: {
          article_id: string
          content: string
          created_at: string | null
          id: string
        }
        Insert: {
          article_id: string
          content: string
          created_at?: string | null
          id?: string
        }
        Update: {
          article_id?: string
          content?: string
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "article_versions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "article_versions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          ai_content_gap: Json | null
          anchor_target_url: string | null
          author_profile_id: string | null
          cluster_id: string | null
          content: string | null
          created_at: string | null
          geo: string | null
          id: string
          is_public: boolean | null
          keyword_id: string | null
          keywords: string[] | null
          language: string | null
          lsi_keywords: Json | null
          meta_description: string | null
          project_id: string | null
          published_url: string | null
          scheduled_at: string | null
          seo_score: Json | null
          share_token: string | null
          status: string | null
          suggested_outline: Json | null
          telegraph_path: string | null
          telegraph_url: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          ai_content_gap?: Json | null
          anchor_target_url?: string | null
          author_profile_id?: string | null
          cluster_id?: string | null
          content?: string | null
          created_at?: string | null
          geo?: string | null
          id?: string
          is_public?: boolean | null
          keyword_id?: string | null
          keywords?: string[] | null
          language?: string | null
          lsi_keywords?: Json | null
          meta_description?: string | null
          project_id?: string | null
          published_url?: string | null
          scheduled_at?: string | null
          seo_score?: Json | null
          share_token?: string | null
          status?: string | null
          suggested_outline?: Json | null
          telegraph_path?: string | null
          telegraph_url?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          ai_content_gap?: Json | null
          anchor_target_url?: string | null
          author_profile_id?: string | null
          cluster_id?: string | null
          content?: string | null
          created_at?: string | null
          geo?: string | null
          id?: string
          is_public?: boolean | null
          keyword_id?: string | null
          keywords?: string[] | null
          language?: string | null
          lsi_keywords?: Json | null
          meta_description?: string | null
          project_id?: string | null
          published_url?: string | null
          scheduled_at?: string | null
          seo_score?: Json | null
          share_token?: string | null
          status?: string | null
          suggested_outline?: Json | null
          telegraph_path?: string | null
          telegraph_url?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "author_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "articles_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      author_profiles: {
        Row: {
          avatar_icon: string | null
          created_at: string | null
          description: string | null
          id: string
          is_gogetlinks_profile: boolean
          is_miralinks_profile: boolean
          name: string
          niche: string | null
          stop_words: string[] | null
          style_analysis: Json | null
          style_examples: string | null
          system_instruction: string | null
          system_prompt_override: string | null
          temperature: number | null
          type: string
          user_id: string | null
          voice_tone: string | null
        }
        Insert: {
          avatar_icon?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_gogetlinks_profile?: boolean
          is_miralinks_profile?: boolean
          name: string
          niche?: string | null
          stop_words?: string[] | null
          style_analysis?: Json | null
          style_examples?: string | null
          system_instruction?: string | null
          system_prompt_override?: string | null
          temperature?: number | null
          type?: string
          user_id?: string | null
          voice_tone?: string | null
        }
        Update: {
          avatar_icon?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_gogetlinks_profile?: boolean
          is_miralinks_profile?: boolean
          name?: string
          niche?: string | null
          stop_words?: string[] | null
          style_analysis?: Json | null
          style_examples?: string | null
          system_instruction?: string | null
          system_prompt_override?: string | null
          temperature?: number | null
          type?: string
          user_id?: string | null
          voice_tone?: string | null
        }
        Relationships: []
      }
      bulk_job_items: {
        Row: {
          article_id: string | null
          bulk_job_id: string
          created_at: string | null
          error_message: string | null
          id: string
          keyword_id: string | null
          seed_keyword: string
          status: string
          updated_at: string | null
        }
        Insert: {
          article_id?: string | null
          bulk_job_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          keyword_id?: string | null
          seed_keyword: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          article_id?: string | null
          bulk_job_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          keyword_id?: string | null
          seed_keyword?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bulk_job_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_job_items_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_job_items_bulk_job_id_fkey"
            columns: ["bulk_job_id"]
            isOneToOne: false
            referencedRelation: "bulk_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bulk_job_items_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_jobs: {
        Row: {
          author_profile_id: string | null
          completed_items: number
          created_at: string | null
          id: string
          status: string
          total_items: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          author_profile_id?: string | null
          completed_items?: number
          created_at?: string | null
          id?: string
          status?: string
          total_items?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          author_profile_id?: string | null
          completed_items?: number
          created_at?: string | null
          id?: string
          status?: string
          total_items?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_jobs_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "author_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clusters: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      competitors: {
        Row: {
          article_id: string
          created_at: string | null
          domain: string
          h2_count: number | null
          id: string
          is_selected: boolean | null
          meta_description: string | null
          title: string | null
          type: string | null
          url: string
          word_count: number | null
        }
        Insert: {
          article_id: string
          created_at?: string | null
          domain: string
          h2_count?: number | null
          id?: string
          is_selected?: boolean | null
          meta_description?: string | null
          title?: string | null
          type?: string | null
          url: string
          word_count?: number | null
        }
        Update: {
          article_id?: string
          created_at?: string | null
          domain?: string
          h2_count?: number | null
          id?: string
          is_selected?: boolean | null
          meta_description?: string | null
          title?: string | null
          type?: string | null
          url?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitors_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_articles: {
        Row: {
          category_id: string
          content: string
          created_at: string | null
          id: string
          is_published: boolean | null
          slug: string
          sort_order: number | null
          title: string
          updated_at: string | null
        }
        Insert: {
          category_id: string
          content?: string
          created_at?: string | null
          id?: string
          is_published?: boolean | null
          slug: string
          sort_order?: number | null
          title: string
          updated_at?: string | null
        }
        Update: {
          category_id?: string
          content?: string
          created_at?: string | null
          id?: string
          is_published?: boolean | null
          slug?: string
          sort_order?: number | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "faq_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "faq_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      faq_categories: {
        Row: {
          created_at: string | null
          icon: string | null
          id: string
          slug: string
          sort_order: number | null
          title: string
        }
        Insert: {
          created_at?: string | null
          icon?: string | null
          id?: string
          slug: string
          sort_order?: number | null
          title: string
        }
        Update: {
          created_at?: string | null
          icon?: string | null
          id?: string
          slug?: string
          sort_order?: number | null
          title?: string
        }
        Relationships: []
      }
      generation_queue: {
        Row: {
          article_id: string | null
          author_profile_id: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          id: string
          keyword_id: string | null
          max_retries: number
          priority: number
          request_payload: Json
          retry_count: number
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          article_id?: string | null
          author_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          keyword_id?: string | null
          max_retries?: number
          priority?: number
          request_payload?: Json
          retry_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          article_id?: string | null
          author_profile_id?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          keyword_id?: string | null
          max_retries?: number
          priority?: number
          request_payload?: Json
          retry_count?: number
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_queue_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_queue_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_queue_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "author_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_queue_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      indexing_logs: {
        Row: {
          article_id: string | null
          created_at: string | null
          id: string
          provider: string
          response_message: string | null
          status: string
          url: string
          user_id: string
        }
        Insert: {
          article_id?: string | null
          created_at?: string | null
          id?: string
          provider: string
          response_message?: string | null
          status?: string
          url: string
          user_id: string
        }
        Update: {
          article_id?: string | null
          created_at?: string | null
          id?: string
          provider?: string
          response_message?: string | null
          status?: string
          url?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "indexing_logs_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indexing_logs_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      keywords: {
        Row: {
          competitor_lists: Json | null
          competitor_tables: Json | null
          content_gaps: Json | null
          created_at: string | null
          difficulty: number | null
          geo: string | null
          id: string
          intent: string | null
          language: string | null
          lsi_keywords: string[] | null
          must_cover_topics: string[] | null
          questions: string[] | null
          recommended_headings: string[] | null
          seed_keyword: string
          user_id: string
          volume: number | null
        }
        Insert: {
          competitor_lists?: Json | null
          competitor_tables?: Json | null
          content_gaps?: Json | null
          created_at?: string | null
          difficulty?: number | null
          geo?: string | null
          id?: string
          intent?: string | null
          language?: string | null
          lsi_keywords?: string[] | null
          must_cover_topics?: string[] | null
          questions?: string[] | null
          recommended_headings?: string[] | null
          seed_keyword: string
          user_id: string
          volume?: number | null
        }
        Update: {
          competitor_lists?: Json | null
          competitor_tables?: Json | null
          content_gaps?: Json | null
          created_at?: string | null
          difficulty?: number | null
          geo?: string | null
          id?: string
          intent?: string | null
          language?: string | null
          lsi_keywords?: string[] | null
          must_cover_topics?: string[] | null
          questions?: string[] | null
          recommended_headings?: string[] | null
          seed_keyword?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: []
      }
      legal_pages: {
        Row: {
          content: string
          id: string
          slug: string
          title: string
          updated_at: string | null
        }
        Insert: {
          content?: string
          id?: string
          slug: string
          title?: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          id?: string
          slug?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          message: string
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          message: string
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          message?: string
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      paa_questions: {
        Row: {
          answer_snippet: string | null
          article_id: string
          created_at: string | null
          id: string
          question: string
        }
        Insert: {
          answer_snippet?: string | null
          article_id: string
          created_at?: string | null
          id?: string
          question: string
        }
        Update: {
          answer_snippet?: string | null
          article_id?: string
          created_at?: string | null
          id?: string
          question?: string
        }
        Relationships: [
          {
            foreignKeyName: "paa_questions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "paa_questions_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_logs: {
        Row: {
          amount_rub: number
          created_at: string
          email: string | null
          id: string
          order_id: string | null
          plan_id: string | null
          raw_payload: Json | null
          status: string
          user_id: string
        }
        Insert: {
          amount_rub?: number
          created_at?: string
          email?: string | null
          id?: string
          order_id?: string | null
          plan_id?: string | null
          raw_payload?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          amount_rub?: number
          created_at?: string
          email?: string | null
          id?: string
          order_id?: string | null
          plan_id?: string | null
          raw_payload?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          credits_amount: number
          email: string | null
          full_name: string | null
          ghost_api_key: string | null
          ghost_url: string | null
          gsc_json_key: string | null
          id: string
          is_active: boolean
          last_ip: string | null
          last_login_at: string | null
          medium_token: string | null
          monthly_limit: number | null
          onboarding_niche: string | null
          plan: string | null
          planned_articles_month: number | null
          preferred_language: string | null
          referral_source: string | null
          registration_ip: string | null
          theme_preference: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          credits_amount?: number
          email?: string | null
          full_name?: string | null
          ghost_api_key?: string | null
          ghost_url?: string | null
          gsc_json_key?: string | null
          id: string
          is_active?: boolean
          last_ip?: string | null
          last_login_at?: string | null
          medium_token?: string | null
          monthly_limit?: number | null
          onboarding_niche?: string | null
          plan?: string | null
          planned_articles_month?: number | null
          preferred_language?: string | null
          referral_source?: string | null
          registration_ip?: string | null
          theme_preference?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          credits_amount?: number
          email?: string | null
          full_name?: string | null
          ghost_api_key?: string | null
          ghost_url?: string | null
          gsc_json_key?: string | null
          id?: string
          is_active?: boolean
          last_ip?: string | null
          last_login_at?: string | null
          medium_token?: string | null
          monthly_limit?: number | null
          onboarding_niche?: string | null
          plan?: string | null
          planned_articles_month?: number | null
          preferred_language?: string | null
          referral_source?: string | null
          registration_ip?: string | null
          theme_preference?: string | null
        }
        Relationships: []
      }
      projects: {
        Row: {
          author_avatar: string | null
          author_bio: string | null
          author_name: string | null
          auto_interlinking: boolean
          created_at: string
          custom_domain: string | null
          domain: string
          font_pair: string | null
          footer_link: Json | null
          github_repo: string | null
          github_token: string | null
          hosting_platform: string | null
          id: string
          injection_links: Json | null
          language: string
          last_ping_at: string | null
          last_ping_status: string | null
          name: string
          primary_color: string | null
          region: string
          site_about: string | null
          site_contacts: string | null
          site_copyright: string | null
          site_name: string | null
          site_privacy: string | null
          total_views: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          author_avatar?: string | null
          author_bio?: string | null
          author_name?: string | null
          auto_interlinking?: boolean
          created_at?: string
          custom_domain?: string | null
          domain?: string
          font_pair?: string | null
          footer_link?: Json | null
          github_repo?: string | null
          github_token?: string | null
          hosting_platform?: string | null
          id?: string
          injection_links?: Json | null
          language?: string
          last_ping_at?: string | null
          last_ping_status?: string | null
          name: string
          primary_color?: string | null
          region?: string
          site_about?: string | null
          site_contacts?: string | null
          site_copyright?: string | null
          site_name?: string | null
          site_privacy?: string | null
          total_views?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          author_avatar?: string | null
          author_bio?: string | null
          author_name?: string | null
          auto_interlinking?: boolean
          created_at?: string
          custom_domain?: string | null
          domain?: string
          font_pair?: string | null
          footer_link?: Json | null
          github_repo?: string | null
          github_token?: string | null
          hosting_platform?: string | null
          id?: string
          injection_links?: Json | null
          language?: string
          last_ping_at?: string | null
          last_ping_status?: string | null
          name?: string
          primary_color?: string | null
          region?: string
          site_about?: string | null
          site_contacts?: string | null
          site_copyright?: string | null
          site_name?: string | null
          site_privacy?: string | null
          total_views?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      radar_analysis_runs: {
        Row: {
          completed_at: string | null
          completed_prompts: number | null
          created_at: string | null
          current_model: string | null
          current_prompt_text: string | null
          id: string
          project_id: string
          started_at: string | null
          status: string
          total_prompts: number | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          completed_prompts?: number | null
          created_at?: string | null
          current_model?: string | null
          current_prompt_text?: string | null
          id?: string
          project_id: string
          started_at?: string | null
          status?: string
          total_prompts?: number | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          completed_prompts?: number | null
          created_at?: string | null
          current_model?: string | null
          current_prompt_text?: string | null
          id?: string
          project_id?: string
          started_at?: string | null
          status?: string
          total_prompts?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_analysis_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "radar_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_keywords: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          keyword: string
          last_checked_at: string | null
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          keyword: string
          last_checked_at?: string | null
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          keyword?: string
          last_checked_at?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_keywords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "radar_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_projects: {
        Row: {
          brand_name: string
          created_at: string | null
          data_nuggets: string[] | null
          domain: string
          id: string
          language: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          brand_name: string
          created_at?: string | null
          data_nuggets?: string[] | null
          domain: string
          id?: string
          language?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          brand_name?: string
          created_at?: string | null
          data_nuggets?: string[] | null
          domain?: string
          id?: string
          language?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      radar_prompt_groups: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          project_id: string
          sort_order: number | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          project_id: string
          sort_order?: number | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_order?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_prompt_groups_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "radar_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_prompts: {
        Row: {
          created_at: string | null
          group_id: string | null
          id: string
          project_id: string
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          project_id: string
          text: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          project_id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_prompts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "radar_prompt_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_prompts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "radar_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      radar_results: {
        Row: {
          ai_response_text: string | null
          brand_mentioned: boolean | null
          checked_at: string | null
          competitor_domains: string[] | null
          domain_linked: boolean | null
          id: string
          is_brand_found: boolean | null
          is_domain_found: boolean | null
          keyword_id: string | null
          matched_snippets: string[] | null
          model: string
          prompt_id: string | null
          run_id: string | null
          sentiment: string | null
          sources: Json | null
          status: string
          user_id: string
        }
        Insert: {
          ai_response_text?: string | null
          brand_mentioned?: boolean | null
          checked_at?: string | null
          competitor_domains?: string[] | null
          domain_linked?: boolean | null
          id?: string
          is_brand_found?: boolean | null
          is_domain_found?: boolean | null
          keyword_id?: string | null
          matched_snippets?: string[] | null
          model: string
          prompt_id?: string | null
          run_id?: string | null
          sentiment?: string | null
          sources?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          ai_response_text?: string | null
          brand_mentioned?: boolean | null
          checked_at?: string | null
          competitor_domains?: string[] | null
          domain_linked?: boolean | null
          id?: string
          is_brand_found?: boolean | null
          is_domain_found?: boolean | null
          keyword_id?: string | null
          matched_snippets?: string[] | null
          model?: string
          prompt_id?: string | null
          run_id?: string | null
          sentiment?: string | null
          sources?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "radar_results_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "radar_keywords"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_results_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "radar_prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "radar_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "radar_analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          action: string
          id: string
          request_count: number
          user_id: string
          window_start: string
        }
        Insert: {
          action: string
          id?: string
          request_count?: number
          user_id: string
          window_start?: string
        }
        Update: {
          action?: string
          id?: string
          request_count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      scheduled_generations: {
        Row: {
          article_id: string | null
          author_profile_id: string | null
          created_at: string | null
          id: string
          keyword_id: string
          scheduled_at: string
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          article_id?: string | null
          author_profile_id?: string | null
          created_at?: string | null
          id?: string
          keyword_id: string
          scheduled_at: string
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          article_id?: string | null
          author_profile_id?: string | null
          created_at?: string | null
          id?: string
          keyword_id?: string
          scheduled_at?: string
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_generations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_generations_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_generations_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "author_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_generations_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      serp_results: {
        Row: {
          analyzed_at: string | null
          deep_analysis: Json | null
          headings: Json | null
          id: string
          keyword_id: string
          position: number | null
          snippet: string | null
          title: string | null
          url: string | null
          word_count: number | null
        }
        Insert: {
          analyzed_at?: string | null
          deep_analysis?: Json | null
          headings?: Json | null
          id?: string
          keyword_id: string
          position?: number | null
          snippet?: string | null
          title?: string | null
          url?: string | null
          word_count?: number | null
        }
        Update: {
          analyzed_at?: string | null
          deep_analysis?: Json | null
          headings?: Json | null
          id?: string
          keyword_id?: string
          position?: number | null
          snippet?: string | null
          title?: string | null
          url?: string | null
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "serp_results_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      site_settings: {
        Row: {
          google_verification: string | null
          id: string
          metrica_id: string | null
          updated_at: string | null
          yandex_verification: string | null
        }
        Insert: {
          google_verification?: string | null
          id?: string
          metrica_id?: string | null
          updated_at?: string | null
          yandex_verification?: string | null
        }
        Update: {
          google_verification?: string | null
          id?: string
          metrica_id?: string | null
          updated_at?: string | null
          yandex_verification?: string | null
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          can_export_html: boolean | null
          can_use_clusters: boolean | null
          can_use_paa: boolean | null
          created_at: string | null
          description_en: string | null
          description_ru: string | null
          feature_flags: Json
          features: Json | null
          id: string
          monthly_article_limit: number
          name: string
          price_rub: number | null
          price_usd: number | null
        }
        Insert: {
          can_export_html?: boolean | null
          can_use_clusters?: boolean | null
          can_use_paa?: boolean | null
          created_at?: string | null
          description_en?: string | null
          description_ru?: string | null
          feature_flags?: Json
          features?: Json | null
          id: string
          monthly_article_limit: number
          name: string
          price_rub?: number | null
          price_usd?: number | null
        }
        Update: {
          can_export_html?: boolean | null
          can_use_clusters?: boolean | null
          can_use_paa?: boolean | null
          created_at?: string | null
          description_en?: string | null
          description_ru?: string | null
          feature_flags?: Json
          features?: Json | null
          id?: string
          monthly_article_limit?: number
          name?: string
          price_rub?: number | null
          price_usd?: number | null
        }
        Relationships: []
      }
      support_tickets: {
        Row: {
          admin_reply: string | null
          created_at: string | null
          id: string
          message: string
          replied_at: string | null
          status: string
          subject: string
          user_id: string
        }
        Insert: {
          admin_reply?: string | null
          created_at?: string | null
          id?: string
          message: string
          replied_at?: string | null
          status?: string
          subject: string
          user_id: string
        }
        Update: {
          admin_reply?: string | null
          created_at?: string | null
          id?: string
          message?: string
          replied_at?: string | null
          status?: string
          subject?: string
          user_id?: string
        }
        Relationships: []
      }
      task_model_assignments: {
        Row: {
          id: string
          model_key: string
          task_key: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          model_key: string
          task_key: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          model_key?: string
          task_key?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      ticket_messages: {
        Row: {
          created_at: string
          id: string
          message: string
          sender_role: string
          ticket_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          sender_role?: string
          ticket_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          sender_role?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_logs: {
        Row: {
          action: string | null
          created_at: string | null
          id: string
          model_used: string | null
          tokens_used: number | null
          user_id: string
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          id?: string
          model_used?: string | null
          tokens_used?: number | null
          user_id: string
        }
        Update: {
          action?: string | null
          created_at?: string | null
          id?: string
          model_used?: string | null
          tokens_used?: number | null
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_stats: {
        Row: {
          average_content_score: number | null
          last_activity_at: string | null
          total_articles_created: number | null
          total_words_generated: number | null
          user_id: string
        }
        Insert: {
          average_content_score?: number | null
          last_activity_at?: string | null
          total_articles_created?: number | null
          total_words_generated?: number | null
          user_id: string
        }
        Update: {
          average_content_score?: number | null
          last_activity_at?: string | null
          total_articles_created?: number | null
          total_words_generated?: number | null
          user_id?: string
        }
        Relationships: []
      }
      wordpress_sites: {
        Row: {
          app_password: string
          created_at: string | null
          id: string
          is_connected: boolean | null
          site_name: string | null
          site_url: string
          updated_at: string | null
          user_id: string
          username: string
        }
        Insert: {
          app_password: string
          created_at?: string | null
          id?: string
          is_connected?: boolean | null
          site_name?: string | null
          site_url: string
          updated_at?: string | null
          user_id: string
          username: string
        }
        Update: {
          app_password?: string
          created_at?: string | null
          id?: string
          is_connected?: boolean | null
          site_name?: string | null
          site_url?: string
          updated_at?: string | null
          user_id?: string
          username?: string
        }
        Relationships: []
      }
      wp_scheduled_posts: {
        Row: {
          article_id: string
          categories: Json | null
          created_at: string | null
          error_message: string | null
          id: string
          meta_description: string | null
          meta_title: string | null
          publish_immediately: boolean | null
          scheduled_at: string
          seo_plugin: string | null
          site_id: string
          status: string
          tags: string | null
          updated_at: string | null
          user_id: string
          wp_post_id: number | null
          wp_post_url: string | null
        }
        Insert: {
          article_id: string
          categories?: Json | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          publish_immediately?: boolean | null
          scheduled_at: string
          seo_plugin?: string | null
          site_id: string
          status?: string
          tags?: string | null
          updated_at?: string | null
          user_id: string
          wp_post_id?: number | null
          wp_post_url?: string | null
        }
        Update: {
          article_id?: string
          categories?: Json | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          publish_immediately?: boolean | null
          scheduled_at?: string
          seo_plugin?: string | null
          site_id?: string
          status?: string
          tags?: string | null
          updated_at?: string | null
          user_id?: string
          wp_post_id?: number | null
          wp_post_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wp_scheduled_posts_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wp_scheduled_posts_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "public_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wp_scheduled_posts_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "wordpress_sites"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      public_articles: {
        Row: {
          author_profile_id: string | null
          content: string | null
          created_at: string | null
          geo: string | null
          id: string | null
          keywords: string[] | null
          language: string | null
          meta_description: string | null
          published_url: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          author_profile_id?: string | null
          content?: string | null
          created_at?: string | null
          geo?: string | null
          id?: string | null
          keywords?: string[] | null
          language?: string | null
          meta_description?: string | null
          published_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          author_profile_id?: string | null
          content?: string | null
          created_at?: string | null
          geo?: string | null
          id?: string | null
          keywords?: string[] | null
          language?: string | null
          meta_description?: string | null
          published_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "articles_author_profile_id_fkey"
            columns: ["author_profile_id"]
            isOneToOne: false
            referencedRelation: "author_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_add_credits: {
        Args: {
          p_amount: number
          p_comment?: string
          p_notify?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      auto_activate_users: { Args: never; Returns: undefined }
      check_credits: { Args: { p_user_id: string }; Returns: number }
      check_rate_limit: {
        Args: {
          p_action: string
          p_max_requests?: number
          p_user_id: string
          p_window_minutes?: number
        }
        Returns: boolean
      }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      decrypt_sensitive: { Args: { ciphertext: string }; Returns: string }
      deduct_credit: { Args: { p_user_id: string }; Returns: boolean }
      encrypt_sensitive: { Args: { plaintext: string }; Returns: string }
      get_project_github_config: {
        Args: { p_project_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      article_status: "research" | "outline" | "generating" | "completed"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      article_status: ["research", "outline", "generating", "completed"],
    },
  },
} as const
