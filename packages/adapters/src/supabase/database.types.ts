export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type MutableTenantRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  revision: number;
};

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: MutableTenantRow & {
          display_name: string;
          locale: string;
          time_zone: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          display_name?: string;
          locale?: string;
          time_zone?: string;
          created_at?: string;
          updated_at?: string;
          revision?: number;
        };
        Update: {
          display_name?: string;
          locale?: string;
          time_zone?: string;
          updated_at?: string;
          revision?: number;
        };
        Relationships: [];
      };
      devices: {
        Row: MutableTenantRow & {
          public_id: string;
          name: string;
          platform: string;
          app_version: string;
          last_seen_at: string;
          revoked_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          public_id: string;
          name: string;
          platform: string;
          app_version: string;
          last_seen_at?: string;
        };
        Update: {
          name?: string;
          app_version?: string;
          last_seen_at?: string;
          revoked_at?: string | null;
        };
        Relationships: [];
      };
      command_audit: {
        Row: {
          id: string;
          user_id: string;
          device_id: string | null;
          session_id: string | null;
          correlation_id: string;
          tool_name: string;
          outcome: string;
          reason_code: string;
          duration_ms: number | null;
          metadata: Json;
          occurred_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          device_id?: string | null;
          session_id?: string | null;
          correlation_id: string;
          tool_name: string;
          outcome: 'allowed' | 'denied' | 'failed' | 'cancelled';
          reason_code: string;
          duration_ms?: number | null;
          metadata?: Json;
          occurred_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      control_profiles: {
        Row: MutableTenantRow & {
          name: string;
          schema_version: number;
          configuration: Json;
          is_active: boolean;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          schema_version?: number;
          configuration?: Json;
          is_active?: boolean;
        };
        Update: {
          name?: string;
          schema_version?: number;
          configuration?: Json;
          is_active?: boolean;
          revision?: number;
        };
        Relationships: [];
      };
      tool_grants: {
        Row: MutableTenantRow & {
          control_profile_id: string;
          tool_name: string;
          risk_tier: number;
          confirmation_mode: string;
          constraints: Json;
        };
        Insert: {
          id?: string;
          user_id: string;
          control_profile_id: string;
          tool_name: string;
          risk_tier: number;
          confirmation_mode: 'always' | 'session' | 'never';
          constraints?: Json;
        };
        Update: {
          risk_tier?: number;
          confirmation_mode?: 'always' | 'session' | 'never';
          constraints?: Json;
          revision?: number;
        };
        Relationships: [];
      };
      activity_events: {
        Row: {
          id: string;
          user_id: string;
          device_id: string | null;
          event_type: string;
          source: string;
          summary: string;
          metadata: Json;
          occurred_at: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          device_id?: string | null;
          event_type: string;
          source: string;
          summary: string;
          metadata?: Json;
          occurred_at?: string;
          expires_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      account_deletion_requests: {
        Row: {
          id: string;
          user_id: string;
          status: string;
          requested_at: string;
          execute_after: string;
          processing_started_at: string | null;
          attempts: number;
          next_attempt_at: string;
          last_error_code: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: { user_id: string };
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      register_device: {
        Args: {
          p_public_id: string;
          p_name: string;
          p_platform: string;
          p_app_version: string;
        };
        Returns: {
          id: string;
          public_id: string;
          revision: number;
          last_seen_at: string;
        }[];
      };
      update_creator_profile: {
        Args: {
          p_idempotency_key: string;
          p_expected_revision: number;
          p_display_name: string;
          p_locale: string;
          p_time_zone: string;
        };
        Returns: {
          id: string;
          user_id: string;
          display_name: string;
          locale: string;
          time_zone: string;
          revision: number;
          updated_at: string;
        }[];
      };
      request_account_deletion: {
        Args: Record<string, never>;
        Returns: {
          request_id: string;
          requested_at: string;
          execute_after: string;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
