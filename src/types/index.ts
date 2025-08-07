// Discord-related types
export interface DiscordCommand {
  data: any;
  execute: (interaction: any) => Promise<void>;
}

// Notion-related types
export interface NotionUser {
  id: string;
  properties: Record<string, any>;
}

export interface NotionQueryResponse {
  results: NotionUser[];
  next_cursor?: string;
  has_more: boolean;
}

// Bitwarden-related types
export interface BitwardenMember {
  id: string;
  userId?: string;
  email: string;
  name?: string;
  status: number; // 0 = Invited, 1 = Accepted, 2 = Confirmed
  type: number;   // 0 = Owner, 1 = Admin, 2 = User
  accessAll: boolean;
  collections: any[];
  groups: any[];
  resetPasswordEnrolled: boolean;
}

export interface BitwardenInviteRequest {
  emails: string[];
  type: number;
  accessAll: boolean;
  resetPasswordEnrolled: boolean;
  collections: string[];
  groups: string[];
}

export interface BitwardenApiResponse<T = any> {
  data: T;
  continuationToken?: string;
}

// Application-specific types
export interface ProcessingResult {
  success: boolean;
  message: string;
  details?: any;
}

export interface SchedulerStats {
  totalProcessed: number;
  confirmed: number;
  failed: number;
  errors: string[];
  lastRun: Date;
}

// Environment configuration types
export interface Config {
  discord: {
    token: string;
    clientId: string;
  };
  notion: {
    token: string;
    databaseId: string;
  };
  bitwarden: {
    clientId: string;
    clientSecret: string;
    orgId: string;
  };
  nodeEnv: string;
}