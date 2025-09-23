export interface BitwardenInviteRequest {
  emails: string[];
  type: number;
  collections: Array<{
    id: string;
    readOnly: boolean;
    hidePasswords: boolean;
    manage: boolean;
  }>;
  permissions: {};
  groups: string[];
  accessSecretsManager: boolean;
}

export interface BitwardenTokenResponse {
  Kdf: number;
  KdfIterations: number;
  KdfMemory: number | null;
  KdfParallelism: number | null;
  Key: string;
  PrivateKey: string;
  ResetMasterPassword: boolean;
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}