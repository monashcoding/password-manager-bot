import axios from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { UserInfo } from './notion';

interface BitwardenInviteResult {
  success: boolean;
  error?: string;
  inviteId?: string;
}

interface BitwardenAuthResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

// Get OAuth access token for Bitwarden API
async function getBitwardenToken(): Promise<string> {
  // Return cached token if still valid
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.post<BitwardenAuthResponse>(
      `${config.bitwarden.baseUrl}/identity/connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'api.organization',
        client_id: config.bitwarden.clientId,
        client_secret: config.bitwarden.clientSecret,
        device_identifier: 'discord-bot-' + Math.random().toString(36).substring(7),
        device_type: '8', // API device type
        device_name: 'Discord Password Manager Bot'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    cachedToken = response.data.access_token;
    tokenExpiry = Date.now() + (response.data.expires_in * 1000) - 60000; // Expire 1 minute early for safety

    logger.info('Successfully obtained Bitwarden access token');
    return cachedToken;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('Bitwarden auth error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
    } else {
      logger.error('Error getting Bitwarden token:', error);
    }
    throw new Error('Failed to authenticate with Bitwarden API');
  }
}

// Invite user to Bitwarden organization
export async function inviteUserToBitwarden(email: string, userInfo: UserInfo): Promise<BitwardenInviteResult> {
  try {
    const token = await getBitwardenToken();

    // Prepare invite payload
    const invitePayload = {
      emails: [email],
      type: 2, // User type (2 = User, 1 = Admin, 0 = Owner)
      accessAll: false, // Don't give access to all collections by default
      resetPasswordEnrolled: false,
      collections: [], // You can specify specific collections here if needed
      groups: [] // You can specify groups here if needed
    };

    logger.info(`Sending Bitwarden invite for ${email} with payload:`, invitePayload);

    // Try the official Bitwarden API endpoints in order of preference
    const possibleEndpoints = [
      `${config.bitwarden.baseUrl}/api/public/members`, // Official API
      `${config.bitwarden.baseUrl}/public/members`,     // Alternative
      `${config.bitwarden.baseUrl}/api/organizations/${config.bitwarden.orgId}/users/invite`, // From forum discussion
      `${config.bitwarden.baseUrl}/api/members`,        // Simplified
      `${config.bitwarden.baseUrl}/api/invite`          // Last resort
    ];

    let response;
    let lastError;

    for (const endpoint of possibleEndpoints) {
      try {
        logger.info(`Trying Bitwarden invite endpoint: ${endpoint}`);
        
        response = await axios.post(
          endpoint,
          invitePayload,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }
        );
        
        logger.info(`✅ SUCCESS with endpoint: ${endpoint}`);
        break; // Success, exit loop
        
      } catch (error) {
        lastError = error;
        if (axios.isAxiosError(error)) {
          logger.info(`❌ ${endpoint} failed: ${error.response?.status} ${error.response?.statusText}`);
        }
        continue; // Try next endpoint
      }
    }

    if (!response) {
      // All endpoints failed, throw the last error
      throw lastError;
    }

    logger.info(`Bitwarden invite successful for ${email}:`, response.data);

    return {
      success: true,
      inviteId: response.data.id || 'unknown'
    };

  } catch (error) {
    let errorMessage = 'Unknown error occurred';

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      logger.error(`Bitwarden invite error for ${email}:`, {
        status,
        statusText: error.response?.statusText,
        data: errorData
      });

      // Handle specific error cases
      if (status === 400) {
        if (errorData?.message?.includes('already exists') || errorData?.message?.includes('already invited')) {
          errorMessage = 'User is already invited or exists in the organization';
        } else {
          errorMessage = `Invalid request: ${errorData?.message || 'Bad request'}`;
        }
      } else if (status === 401) {
        errorMessage = 'Authentication failed with Bitwarden API';
      } else if (status === 403) {
        errorMessage = 'Insufficient permissions to invite users';
      } else if (status === 429) {
        errorMessage = 'Rate limit exceeded, please try again later';
      } else {
        errorMessage = `API error (${status}): ${errorData?.message || 'Unknown error'}`;
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

// Get list of organization members (for the scheduled job)
export async function getOrganizationMembers(): Promise<any[]> {
  try {
    const token = await getBitwardenToken();

    // Try official API endpoints
    const possibleEndpoints = [
      `${config.bitwarden.baseUrl}/api/public/members`,
      `${config.bitwarden.baseUrl}/public/members`,
      `${config.bitwarden.baseUrl}/api/members`
    ];

    for (const endpoint of possibleEndpoints) {
      try {
        logger.info(`Trying to fetch members from: ${endpoint}`);
        
        const response = await axios.get(
          endpoint,
          {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          }
        );

        logger.info(`✅ Successfully fetched members from: ${endpoint}`);
        return response.data.data || response.data || [];
        
      } catch (error) {
        if (axios.isAxiosError(error)) {
          logger.info(`❌ ${endpoint} failed: ${error.response?.status} ${error.response?.statusText}`);
        }
        continue;
      }
    }

    throw new Error('All member endpoints failed');

  } catch (error) {
    logger.error('Error fetching organization members:', error);
    throw error;
  }
}

// Confirm member (for the scheduled job)
export async function confirmMember(memberId: string): Promise<boolean> {
  try {
    const token = await getBitwardenToken();

    await axios.post(
      `${config.bitwarden.baseUrl}/api/public/members/${memberId}/confirm`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    logger.info(`Successfully confirmed member: ${memberId}`);
    return true;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`Error confirming member ${memberId}:`, {
        status: error.response?.status,
        data: error.response?.data
      });
    } else {
      logger.error(`Error confirming member ${memberId}:`, error);
    }
    return false;
  }
}

// Test Bitwarden API connection
export async function testBitwardenConnection(): Promise<boolean> {
  try {
    await getBitwardenToken();
    const members = await getOrganizationMembers();
    logger.info(`Bitwarden connection successful. Found ${members.length} organization members.`);
    return true;
  } catch (error) {
    logger.error('Bitwarden connection test failed:', error);
    return false;
  }
}