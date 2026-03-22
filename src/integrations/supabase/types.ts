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
      articles: {
        Row: {
          author_profile_id: string | null
          content: string | null
          created_at: string | null
          id: string
          keyword_id: string | null
          meta_description: string | null
          scheduled_at: string | null
          seo_score: Json | null
          status: string | null
          title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          author_profile_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          keyword_id?: string | null
          meta_description?: string | null
          scheduled_at?: string | null
          seo_score?: Json | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          author_profile_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          keyword_id?: string | null
          meta_description?: string | null
          scheduled_at?: string | null
          seo_score?: Json | null
          status?: string | null
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
            foreignKeyName: "articles_keyword_id_fkey"
            columns: ["keyword_id"]
            isOneToOne: false
            referencedRelation: "keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      author_profiles: {
        Row: {
          created_at: string | null
          id: string
          name: string
          niche: string | null
          stop_words: string[] | null
          style_analysis: Json | null
          style_examples: string | null
          system_prompt_override: string | null
          user_id: string
          voice_tone: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          niche?: string | null
          stop_words?: string[] | null
          style_analysis?: Json | null
          style_examples?: string | null
          system_prompt_override?: string | null
          user_id: string
          voice_tone?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          niche?: string | null
          stop_words?: string[] | null
          style_analysis?: Json | null
          style_examples?: string | null
          system_prompt_override?: string | null
          user_id?: string
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
        ]
      }
      keywords: {
        Row: {
          competitor_lists: Json | null
          competitor_tables: Json | null
          content_gaps: Json | null
          created_at: string | null
          difficulty: number | null
          id: string
          intent: string | null
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
          id?: string
          intent?: string | null
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
          id?: string
          intent?: string | null
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
      profiles: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          gsc_json_key: string | null
          id: string
          is_active: boolean
          monthly_limit: number | null
          plan: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          gsc_json_key?: string | null
          id: string
          is_active?: boolean
          monthly_limit?: number | null
          plan?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          gsc_json_key?: string | null
          id?: string
          is_active?: boolean
          monthly_limit?: number | null
          plan?: string | null
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
      [_ in never]: never
    }
    Functions: {
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
    },
  },
} as const
