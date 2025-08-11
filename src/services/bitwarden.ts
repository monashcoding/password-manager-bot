import axios, { AxiosResponse } from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { UserInfo } from './notion';

interface BitwardenInviteResult {
  success: boolean;
  error?: string;
  inviteId?: string;
}

interface AdminAuthResponse {
  message?: string;
  status?: string;
}

interface InviteUserRequest {
  email: string;
}

let adminCookies: string[] = [];
let cookieExpiry: number = 0;

/**
 * Authenticate with Vaultwarden admin panel to get JWT cookie
 */
async function getAdminCookies(): Promise<string[]> {
  // Return cached cookies if still valid (admin session lasts 20 minutes by default)
  if (adminCookies.length > 0 && Date.now() < cookieExpiry) {
    return adminCookies;
  }
  
  if (!config.bitwarden.adminToken) {
    throw new Error('VAULTWARDEN_ADMIN_TOKEN not configured');
  }

  try {
    logger.info('Authenticating with Vaultwarden admin panel...');
    
    // Step 1: POST to /admin with form data containing the admin token
    const response: AxiosResponse<any> = await axios.post(
      `${config.bitwarden.baseUrl}/admin`,
      new URLSearchParams({
        token: config.bitwarden.adminToken,
        redirect: '' // Optional redirect after login
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        maxRedirects: 0, // Don't follow redirects
        validateStatus: (status) => status < 400 // Accept 3xx redirects as success
      }
    );

    // Extract Set-Cookie headers
    const setCookieHeaders = response.headers['set-cookie'] || [];
    
    if (setCookieHeaders.length === 0) {
      throw new Error('No cookies received from admin authentication');
    }

    // Store cookies and set expiry (admin sessions typically last 20 minutes)
    adminCookies = setCookieHeaders;
    cookieExpiry = Date.now() + (18 * 60 * 1000); // Expire 2 minutes early for safety

    logger.info('✅ Admin authentication successful, cookies obtained');
    return adminCookies;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      // 302 redirect is actually success for admin login
      if (error.response?.status === 302) {
        const setCookieHeaders = error.response.headers['set-cookie'] || [];
        if (setCookieHeaders.length > 0) {
          adminCookies = setCookieHeaders;
          cookieExpiry = Date.now() + (18 * 60 * 1000);
          logger.info('✅ Admin authentication successful (redirect), cookies obtained');
          return adminCookies;
        }
      }
      
      logger.error('Admin authentication failed:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
    } else {
      logger.error('Error during admin authentication:', error);
    }
    throw new Error('Failed to authenticate with Vaultwarden admin panel');
  }
}

/**
 * Parse cookie headers into a cookie string for requests
 */
function parseCookiesForRequest(cookieHeaders: string[]): string {
  return cookieHeaders
    .map(cookie => cookie.split(';')[0]) // Take only the name=value part
    .join('; ');
}

/**
 * Invite user to Vaultwarden instance using admin API
 */
export async function inviteUserToVaultwarden(email: string, userInfo: UserInfo): Promise<BitwardenInviteResult> {
  try {
    const cookies = await getAdminCookies();
    const cookieString = parseCookiesForRequest(cookies);

    const invitePayload: InviteUserRequest = {
      email: email
    };

    logger.info(`Sending Vaultwarden admin invite for ${email}`);

    const response: AxiosResponse<any> = await axios.post(
      `${config.bitwarden.baseUrl}/admin/invite`,
      invitePayload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString
        }
      }
    );

    logger.info(`Vaultwarden admin invite successful for ${email}:`, response.data);

    return {
      success: true,
      inviteId: response.data.Id || response.data.id || 'admin-invite'
    };

  } catch (error) {
    let errorMessage = 'Unknown error occurred';

    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const errorData = error.response?.data;

      logger.error(`Vaultwarden admin invite error for ${email}:`, {
        status,
        statusText: error.response?.statusText,
        data: errorData
      });

      if (status === 401) {
        // Clear cached cookies on auth failure
        adminCookies = [];
        cookieExpiry = 0;
        errorMessage = 'Admin authentication failed - invalid token or expired session';
      } else if (status === 400) {
        if (errorData?.message?.includes('already') || errorData?.Message?.includes('already')) {
          errorMessage = 'User already exists or is already invited';
        } else {
          errorMessage = `Invalid request: ${errorData?.message || errorData?.Message || 'Bad request'}`;
        }
      } else if (status === 409) {
        errorMessage = 'User already exists in the system';
      } else {
        errorMessage = `Admin API error (${status}): ${errorData?.message || errorData?.Message || 'Unknown error'}`;
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

/**
 * Get list of all Vaultwarden users using admin API
 */
export async function getAllVaultwardenUsers(): Promise<any[]> {
  try {
    const cookies = await getAdminCookies();
    const cookieString = parseCookiesForRequest(cookies);

    const response: AxiosResponse<any[]> = await axios.get(
      `${config.bitwarden.baseUrl}/admin/users`,
      {
        headers: {
          'Cookie': cookieString
        }
      }
    );

    const users = response.data || [];
    logger.info(`Successfully fetched ${users.length} Vaultwarden users`);
    
    return users;

  } catch (error) {
    logger.error('Error fetching Vaultwarden users:', error);
    throw error;
  }
}

/**
 * Delete user from Vaultwarden using admin API
 */
export async function deleteVaultwardenUser(userUuid: string): Promise<boolean> {
  try {
    const cookies = await getAdminCookies();
    const cookieString = parseCookiesForRequest(cookies);

    await axios.post(
      `${config.bitwarden.baseUrl}/admin/users/${userUuid}/delete`,
      {},
      {
        headers: {
          'Cookie': cookieString
        }
      }
    );

    logger.info(`Successfully deleted user: ${userUuid}`);
    return true;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`Error deleting user ${userUuid}:`, {
        status: error.response?.status,
        data: error.response?.data
      });
    } else {
      logger.error(`Error deleting user ${userUuid}:`, error);
    }
    return false;
  }
}

/**
 * Test Vaultwarden admin API connection
 */
export async function testVaultwardenAdminConnection(): Promise<boolean> {
  try {
    await getAdminCookies();
    const users = await getAllVaultwardenUsers();
    
    logger.info('Vaultwarden admin API connection successful!');
    logger.info(`Found ${users.length} total users in the system`);
    
    return true;
  } catch (error) {
    logger.error('Vaultwarden admin API connection test failed:', error);
    return false;
  }
}

// Alternative function names for clarity
export const inviteUserToBitwarden = inviteUserToVaultwarden;
export const testBitwardenConnection = testVaultwardenAdminConnection;