import axios from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { UserInfo } from './notion';
import { BitwardenTokenResponse, BitwardenInviteRequest } from '../types';

interface BitwardenInviteResult {
  success: boolean;
  error?: string;
  inviteId?: string;
}

interface OrganizationUser {
  accessAll: boolean;
  accessSecretsManager: boolean;
  avatarColor: string | null;
  claimedByOrganization: boolean;
  collections: any[];
  email: string;
  externalId: string | null;
  groups: any[];
  hasMasterPassword: boolean;
  id: string;
  managedByOrganization: boolean;
  name: string;
  object: string;
  permissions: any;
  resetPasswordEnrolled: boolean;
  ssoBound: boolean;
  status: number;
  twoFactorEnabled: boolean;
  type: number;
  userId: string;
  usesKeyConnector: boolean;
}

interface OrganizationUsersResponse {
  continuationToken: string | null;
  data: OrganizationUser[];
}

interface UserPublicKeyResponse {
  object: string;
  publicKey: string;
  userId: string;
}

interface ConfirmUserResult {
  success: boolean;
  error?: string;
}

interface ReinviteUserResult {
  success: boolean;
  error?: string;
}

// Team to collection ID mapping - Maps Notion team names to Bitwarden collection IDs
const ROLE_TO_COLLECTIONS: Record<string, string[]> = {
  // Individual team collections
  'Sponsorship': ['b4fde2ea-7a77-443f-89bb-ce34e3f702ec'],
  'Projects': ['a3cc60a8-5b19-4c15-89f7-9f41208d23ef'],
  'Media': ['f9e1baa2-e278-4d48-b9f2-363d54265b8f'],
  'Management': ['e2e4647a-0601-4da9-b3ed-e42b6345b658'],
  'Human Resources': ['807c2b19-1f5a-4e73-b56e-df8d466b5766'],
  'Events': ['c62b2418-68bc-467f-a4e0-1b3436ca9b01'],
  'Outreach': ['c62b2418-68bc-467f-a4e0-1b3436ca9b01'],
  'Design': ['ef8a1462-d62c-4071-9f08-aaafccc46a1a'],
  'Marketing': ['2d9d5027-1cff-40bd-90b5-1abb40b4f2cb'],
  
  // Special cases
  'All Teams': ['40e34b51-e4ae-4d4d-9b0e-a1e2a4b700e8'], // Access to everything
  
  // Fallback for unknown teams - gets basic access
  'default': ['40e34b51-e4ae-4d4d-9b0e-a1e2a4b700e8'], // All Teams collection as fallback
};

// Reverse mapping from collection ID to collection name
const COLLECTION_ID_TO_NAME: Record<string, string> = {
  'b4fde2ea-7a77-443f-89bb-ce34e3f702ec': 'Sponsorship',
  'a3cc60a8-5b19-4c15-89f7-9f41208d23ef': 'Projects',
  'f9e1baa2-e278-4d48-b9f2-363d54265b8f': 'Media',
  'e2e4647a-0601-4da9-b3ed-e42b6345b658': 'Management',
  '807c2b19-1f5a-4e73-b56e-df8d466b5766': 'Human Resources',
  'c62b2418-68bc-467f-a4e0-1b3436ca9b01': 'Events',
  'ef8a1462-d62c-4071-9f08-aaafccc46a1a': 'Design',
  '2d9d5027-1cff-40bd-90b5-1abb40b4f2cb': 'Marketing',
  '40e34b51-e4ae-4d4d-9b0e-a1e2a4b700e8': 'All Teams',
};

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - (5 * 60 * 1000)) {
    return cachedToken;
  }

  try {
    const response = await axios.post<BitwardenTokenResponse>(
      `${config.bitwarden.baseUrl}/identity/connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'api',
        client_id: config.bitwarden.userClientId,
        client_secret: config.bitwarden.userClientSecret,
        device_identifier: 'discord-bot',
        device_name: 'discord-bot',
        device_type: 'discord-bot'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    const tokenData = response.data;
    cachedToken = tokenData.access_token;
    tokenExpiry = Date.now() + (tokenData.expires_in * 1000);

    return cachedToken!;

  } catch (error: any) {
    if (error.response) {
      logger.error('Failed to get Bitwarden access token:', {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    } else {
      logger.error('Error getting Bitwarden access token:', error);
    }
    throw new Error('Failed to authenticate with Bitwarden API');
  }
}

function getCollectionsForRole(role: string): Array<{id: string, readOnly: boolean, hidePasswords: boolean, manage: boolean}> {
  let collectionIds = ROLE_TO_COLLECTIONS[role] || ROLE_TO_COLLECTIONS[role.toLowerCase()] || ROLE_TO_COLLECTIONS['default'];
  
  if (!collectionIds) {
    logger.warn(`No collection mapping found for role: ${role}, using default`);
    collectionIds = ROLE_TO_COLLECTIONS['default'];
  }
  
  // Always ensure the "All teams" collection is included for every user
  const allTeamsCollectionId = ROLE_TO_COLLECTIONS['All Teams'][0];
  if (!collectionIds.includes(allTeamsCollectionId)) {
    collectionIds = [...collectionIds, allTeamsCollectionId];
  }
  
  return collectionIds.map(id => ({
    id,
    readOnly: true,
    hidePasswords: false,
    manage: false
  }));
}

export function getCollectionNamesForRole(role: string): string[] {
  let collectionIds = ROLE_TO_COLLECTIONS[role] || ROLE_TO_COLLECTIONS[role.toLowerCase()] || ROLE_TO_COLLECTIONS['default'];
  
  if (!collectionIds) {
    logger.warn(`No collection mapping found for role: ${role}, using default`);
    collectionIds = ROLE_TO_COLLECTIONS['default'];
  }
  
  // Always ensure the "All teams" collection is included for every user
  const allTeamsCollectionId = ROLE_TO_COLLECTIONS['All Teams'][0];
  if (!collectionIds.includes(allTeamsCollectionId)) {
    collectionIds = [...collectionIds, allTeamsCollectionId];
  }
  
  // Map collection IDs to names and filter out any unknown collections
  const collectionNames = collectionIds
    .map(id => COLLECTION_ID_TO_NAME[id])
    .filter(name => name !== undefined);
  
  // Remove duplicates (in case Media appears twice)
  return Array.from(new Set(collectionNames));
}

export async function inviteUserToVaultwarden(email: string, userInfo: UserInfo): Promise<BitwardenInviteResult> {
  try {
    const accessToken = await getAccessToken();
    const collections = getCollectionsForRole(userInfo.role || 'member');

    const inviteData: BitwardenInviteRequest = {
      emails: [email],
      type: 2,
      collections,
      permissions: {},
      groups: [],
      accessSecretsManager: false
    };

    logger.info(`Sending Bitwarden organization invite for ${email} with role: ${userInfo.role}`);

    const response = await axios.post(
      `${config.bitwarden.baseUrl}/api/organizations/${config.bitwarden.orgId}/users/invite`,
      inviteData,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return {
      success: true,
      inviteId: (response.data as any)?.Id || (response.data as any)?.id || 'org-invite'
    };

  } catch (error: any) {
    let errorMessage = 'Unknown error occurred';

    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      logger.error(`Bitwarden organization invite error for ${email}:`, {
        status,
        statusText: error.response.statusText,
        data: errorData
      });

      if (status === 401) {
        cachedToken = null;
        tokenExpiry = 0;
        errorMessage = 'Authentication failed - invalid credentials or expired token';
      } else if (status === 400) {
        if (errorData?.message?.includes('already') || errorData?.Message?.includes('already')) {
          errorMessage = 'User already exists or is already invited';
        } else {
          errorMessage = `Invalid request: ${errorData?.message || errorData?.Message || 'Bad request'}`;
        }
      } else if (status === 409) {
        errorMessage = 'User already exists in the organization';
      } else {
        errorMessage = `API error (${status}): ${errorData?.message || errorData?.Message || 'Unknown error'}`;
      }
    } else {
      logger.error(`Non-HTTP error inviting ${email}:`, error);
      errorMessage = 'Network or system error occurred';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

export async function getUserByEmail(email: string): Promise<OrganizationUser | null> {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.get<OrganizationUsersResponse>(
      `${config.bitwarden.baseUrl}/api/organizations/${config.bitwarden.orgId}/users?includeCollections=true`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const users = response.data.data;
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (user) {
      logger.info(`Found user: ${user.name} (${user.email}) with ID: ${user.id}`);
    }

    return user || null;

  } catch (error: any) {
    if (error.response) {
      logger.error(`Failed to get organization users:`, {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    } else {
      logger.error('Error getting organization users:', error);
    }
    throw new Error('Failed to fetch organization users');
  }
}

export async function getUserPublicKey(userId: string): Promise<UserPublicKeyResponse | null> {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.get<UserPublicKeyResponse>(
      `${config.bitwarden.baseUrl}/api/users/${userId}/public-key`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;

  } catch (error: any) {
    if (error.response) {
      logger.error(`Failed to get public key for user ${userId}:`, {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data
      });
    } else {
      logger.error(`Error getting public key for user ${userId}:`, error);
    }
    return null;
  }
}

export async function confirmUserMembership(organizationUserId: string, userId: string): Promise<ConfirmUserResult> {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.post(
      `${config.bitwarden.baseUrl}/api/organizations/${config.bitwarden.orgId}/users/${organizationUserId}/confirm`,
      {
        key: userId
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status === 200) {
      logger.info(`Successfully confirmed membership for user: ${organizationUserId}`);
      return { success: true };
    } else {
      return { success: false, error: `Unexpected response status: ${response.status}` };
    }

  } catch (error: any) {
    let errorMessage = 'Unknown error occurred';

    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      logger.error(`Failed to confirm membership for user ${organizationUserId}:`, {
        status,
        statusText: error.response.statusText,
        data: errorData
      });

      if (status === 401) {
        errorMessage = 'Authentication failed - invalid credentials or expired token';
      } else if (status === 400) {
        if (errorData?.message?.includes('Key or UserId is not set') || 
            errorData?.errorModel?.message?.includes('Key or UserId is not set')) {
          errorMessage = 'Invalid key format - may need to use public key instead of userId';
        } else {
          errorMessage = `Invalid request: ${errorData?.message || errorData?.errorModel?.message || errorData?.Message || 'Bad request'}`;
        }
      } else if (status === 404) {
        errorMessage = 'User not found or already confirmed';
      } else {
        errorMessage = `API error (${status}): ${errorData?.message || errorData?.errorModel?.message || errorData?.Message || 'Unknown error'}`;
      }
    } else {
      logger.error(`Non-HTTP error confirming user ${organizationUserId}:`, error);
      errorMessage = 'Network or system error occurred';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}

export async function reinviteUser(organizationUserId: string): Promise<ReinviteUserResult> {
  try {
    const accessToken = await getAccessToken();

    const response = await axios.post(
      `${config.bitwarden.baseUrl}/api/organizations/${config.bitwarden.orgId}/users/${organizationUserId}/reinvite`,
      {}, // Empty body for reinvite
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.status === 200) {
      logger.info(`Successfully resent invitation for user: ${organizationUserId}`);
      return { success: true };
    } else {
      return { success: false, error: `Unexpected response status: ${response.status}` };
    }

  } catch (error: any) {
    let errorMessage = 'Unknown error occurred';

    if (error.response) {
      const status = error.response.status;
      const errorData = error.response.data;

      logger.error(`Failed to reinvite user ${organizationUserId}:`, {
        status,
        statusText: error.response.statusText,
        data: errorData
      });

      if (status === 401) {
        errorMessage = 'Authentication failed - invalid credentials or expired token';
      } else if (status === 404) {
        errorMessage = 'User not found or cannot be reinvited';
      } else if (status === 400) {
        errorMessage = `Invalid request: ${errorData?.message || errorData?.errorModel?.message || errorData?.Message || 'Bad request'}`;
      } else {
        errorMessage = `API error (${status}): ${errorData?.message || errorData?.errorModel?.message || errorData?.Message || 'Unknown error'}`;
      }
    } else {
      logger.error(`Non-HTTP error reinviting user ${organizationUserId}:`, error);
      errorMessage = 'Network or system error occurred';
    }

    return {
      success: false,
      error: errorMessage
    };
  }
}
