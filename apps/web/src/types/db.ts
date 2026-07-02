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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      benchmark_forwards_daily: {
        Row: {
          benchmark: string
          contract_month: string
          ingested_at: string
          price_usd_bbl: number
          settlement_date: string
          source: string
        }
        Insert: {
          benchmark: string
          contract_month: string
          ingested_at?: string
          price_usd_bbl: number
          settlement_date: string
          source: string
        }
        Update: {
          benchmark?: string
          contract_month?: string
          ingested_at?: string
          price_usd_bbl?: number
          settlement_date?: string
          source?: string
        }
        Relationships: []
      }
      benchmark_prices_daily: {
        Row: {
          benchmark: string
          date: string
          ingested_at: string
          price_usd_bbl: number
          source: string
        }
        Insert: {
          benchmark: string
          date: string
          ingested_at?: string
          price_usd_bbl: number
          source: string
        }
        Update: {
          benchmark?: string
          date?: string
          ingested_at?: string
          price_usd_bbl?: number
          source?: string
        }
        Relationships: []
      }
      composition_monthly: {
        Row: {
          grade_id: string
          ingested_at: string
          month: string
          share_pct: number
          source: string
          value_jpy: number
          volume_kl: number
        }
        Insert: {
          grade_id: string
          ingested_at?: string
          month: string
          share_pct: number
          source?: string
          value_jpy: number
          volume_kl: number
        }
        Update: {
          grade_id?: string
          ingested_at?: string
          month?: string
          share_pct?: number
          source?: string
          value_jpy?: number
          volume_kl?: number
        }
        Relationships: [
          {
            foreignKeyName: "composition_monthly_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
        ]
      }
      compute_runs: {
        Row: {
          duration_seconds: number | null
          error_message: string | null
          finished_at: string | null
          id: string
          kind: string
          output_jsonb: Json | null
          row_count: number | null
          started_at: string
          status: string
        }
        Insert: {
          duration_seconds?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind: string
          output_jsonb?: Json | null
          row_count?: number | null
          started_at?: string
          status: string
        }
        Update: {
          duration_seconds?: number | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          kind?: string
          output_jsonb?: Json | null
          row_count?: number | null
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          category: string
          created_at: string
          date_from: string
          date_to: string | null
          description_md: string
          id: string
          impact_grades: string[]
          sources: string[]
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          date_from: string
          date_to?: string | null
          description_md: string
          id: string
          impact_grades?: string[]
          sources?: string[]
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          date_from?: string
          date_to?: string | null
          description_md?: string
          id?: string
          impact_grades?: string[]
          sources?: string[]
          title?: string
        }
        Relationships: []
      }
      grade_hs_mapping: {
        Row: {
          applies_from: string
          applies_to: string | null
          grade_id: string
          hs_code: string
          notes: string | null
          origin_country: string
          weight_pct: number
        }
        Insert: {
          applies_from: string
          applies_to?: string | null
          grade_id: string
          hs_code: string
          notes?: string | null
          origin_country: string
          weight_pct: number
        }
        Update: {
          applies_from?: string
          applies_to?: string | null
          grade_id?: string
          hs_code?: string
          notes?: string | null
          origin_country?: string
          weight_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "grade_hs_mapping_grade_id_fkey"
            columns: ["grade_id"]
            isOneToOne: false
            referencedRelation: "grades"
            referencedColumns: ["id"]
          },
        ]
      }
      grades: {
        Row: {
          api_gravity: number | null
          created_at: string
          display_name: string
          first_seen_in_jcc: string | null
          id: string
          last_seen_in_jcc: string | null
          notes: string | null
          origin_country: string
          primary_benchmark: string | null
          region: string
          sulphur_pct: number | null
          type: string
          updated_at: string
        }
        Insert: {
          api_gravity?: number | null
          created_at?: string
          display_name: string
          first_seen_in_jcc?: string | null
          id: string
          last_seen_in_jcc?: string | null
          notes?: string | null
          origin_country: string
          primary_benchmark?: string | null
          region: string
          sulphur_pct?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          api_gravity?: number | null
          created_at?: string
          display_name?: string
          first_seen_in_jcc?: string | null
          id?: string
          last_seen_in_jcc?: string | null
          notes?: string | null
          origin_country?: string
          primary_benchmark?: string | null
          region?: string
          sulphur_pct?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      crude_supply_monthly: {
        Row: {
          end_inventory_kl: number | null
          import_kl: number | null
          ingested_at: string
          month: string
          non_refining_use_kl: number | null
          production_kl: number | null
          refinery_throughput_kl: number | null
          refining_capacity_bpd: number | null
          source: string
          source_url: string | null
          status: string
          utilization_pct: number | null
        }
        Insert: {
          end_inventory_kl?: number | null
          import_kl?: number | null
          ingested_at?: string
          month: string
          non_refining_use_kl?: number | null
          production_kl?: number | null
          refinery_throughput_kl?: number | null
          refining_capacity_bpd?: number | null
          source?: string
          source_url?: string | null
          status?: string
          utilization_pct?: number | null
        }
        Update: {
          end_inventory_kl?: number | null
          import_kl?: number | null
          ingested_at?: string
          month?: string
          non_refining_use_kl?: number | null
          production_kl?: number | null
          refinery_throughput_kl?: number | null
          refining_capacity_bpd?: number | null
          source?: string
          source_url?: string | null
          status?: string
          utilization_pct?: number | null
        }
        Relationships: []
      }
      oil_stockpile_monthly: {
        Row: {
          government_crude_kl: number | null
          government_days: number | null
          government_products_kl: number | null
          ingested_at: string
          month: string
          private_crude_kl: number | null
          private_days: number | null
          private_products_kl: number | null
          source: string
          source_url: string | null
          status: string
        }
        Insert: {
          government_crude_kl?: number | null
          government_days?: number | null
          government_products_kl?: number | null
          ingested_at?: string
          month: string
          private_crude_kl?: number | null
          private_days?: number | null
          private_products_kl?: number | null
          source?: string
          source_url?: string | null
          status?: string
        }
        Update: {
          government_crude_kl?: number | null
          government_days?: number | null
          government_products_kl?: number | null
          ingested_at?: string
          month?: string
          private_crude_kl?: number | null
          private_days?: number | null
          private_products_kl?: number | null
          source?: string
          source_url?: string | null
          status?: string
        }
        Relationships: []
      }
      imports_monthly: {
        Row: {
          hs_code: string
          ingested_at: string
          month: string
          origin_country: string
          source: string
          value_jpy: number
          volume_kl: number
        }
        Insert: {
          hs_code: string
          ingested_at?: string
          month: string
          origin_country: string
          source?: string
          value_jpy: number
          volume_kl: number
        }
        Update: {
          hs_code?: string
          ingested_at?: string
          month?: string
          origin_country?: string
          source?: string
          value_jpy?: number
          volume_kl?: number
        }
        Relationships: []
      }
      jcc_futures_daily: {
        Row: {
          contract_month: string
          ingested_at: string
          open_interest: number | null
          price_usd_bbl: number
          settlement_date: string
          source: string
          volume: number | null
        }
        Insert: {
          contract_month: string
          ingested_at?: string
          open_interest?: number | null
          price_usd_bbl: number
          settlement_date: string
          source?: string
          volume?: number | null
        }
        Update: {
          contract_month?: string
          ingested_at?: string
          open_interest?: number | null
          price_usd_bbl?: number
          settlement_date?: string
          source?: string
          volume?: number | null
        }
        Relationships: []
      }
      jcc_monthly: {
        Row: {
          ingested_at: string
          jcc_value_jpy_per_kl: number
          jcc_value_usd_per_bbl: number | null
          month: string
          source: string
          source_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          ingested_at?: string
          jcc_value_jpy_per_kl: number
          jcc_value_usd_per_bbl?: number | null
          month: string
          source?: string
          source_url?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          ingested_at?: string
          jcc_value_jpy_per_kl?: number
          jcc_value_usd_per_bbl?: number | null
          month?: string
          source?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
