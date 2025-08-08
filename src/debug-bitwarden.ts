import 'dotenv/config';
import { testBitwardenConnection } from './services/bitwarden';
import { config } from './utils/config';
import { logger } from './utils/logger';
import axios from 'axios';

async function debugBitwardenAuth() {
  logger.info('=== DEBUGGING BITWARDEN API ===');
  
  try {
    // Test 1: Check environment variables
    logger.info('1. Checking environment variables...');
    logger.info(`Client ID: ${config.bitwarden.clientId}`);
    logger.info(`Client Secret: ${config.bitwarden.clientSecret ? '[REDACTED]' : 'MISSING'}`);
    logger.info(`Org ID: ${config.bitwarden.orgId}`);
    
    if (!config.bitwarden.clientId || !config.bitwarden.clientSecret || !config.bitwarden.orgId) {
      logger.error('❌ Missing required Bitwarden environment variables');
      return;
    }
    
    // Test 2: Try manual authentication
    logger.info('2. Testing manual authentication...');
    
    const authPayload = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'api.organization',
      client_id: config.bitwarden.clientId,
      client_secret: config.bitwarden.clientSecret,
      device_identifier: 'discord-bot-debug-' + Math.random().toString(36).substring(7),
      device_type: '8',
      device_name: 'Discord Bot Debug'
    });
    
    logger.info('Auth payload:', {
      grant_type: 'client_credentials',
      scope: 'api.organization',
      client_id: config.bitwarden.clientId,
      client_secret: config.bitwarden.clientSecret.substring(0, 5) + '...',
      device_identifier: 'discord-bot-debug-[random]',
      device_type: '8',
      device_name: 'Discord Bot Debug'
    });
    
    const response = await axios.post(
      `${config.bitwarden.baseUrl}/identity/connect/token`,
      authPayload,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000 // 10 second timeout
      }
    );
    
    logger.info('✅ Authentication successful!');
    logger.info('Token type:', response.data.token_type);
    logger.info('Expires in:', response.data.expires_in, 'seconds');
    logger.info('Access token (first 20 chars):', response.data.access_token.substring(0, 20) + '...');
    
    // Test 3: Try to find organization information
    logger.info('3. Looking for organization information...');
    
    const orgEndpoints = [
      '/api/organizations',
      '/api/public/organization/subscription',
      '/api/organization',
      '/api/profile/organizations'
    ];
    
    for (const endpoint of orgEndpoints) {
      try {
        logger.info(`Trying: ${endpoint}`);
        const orgResponse = await axios.get(
          `${config.bitwarden.baseUrl}${endpoint}`,
          {
            headers: {
              'Authorization': `Bearer ${response.data.access_token}`
            },
            timeout: 5000
          }
        );
        
        logger.info(`✅ SUCCESS: ${endpoint}`);
        logger.info(`Response data:`, JSON.stringify(orgResponse.data, null, 2));
        
        // Look for organization ID in the response
        if (orgResponse.data) {
          const data = orgResponse.data;
          if (data.id) {
            logger.info(`🎯 FOUND ORGANIZATION ID: ${data.id}`);
          }
          if (data.data && Array.isArray(data.data)) {
            data.data.forEach((org: any, index: number) => {
              logger.info(`🎯 Organization ${index + 1} ID: ${org.id} (${org.name || 'Unknown'})`);
            });
          }
        }
        
        break; // Stop on first successful endpoint
        
      } catch (error) {
        if (axios.isAxiosError(error)) {
          logger.info(`   ❌ ${endpoint} - Status: ${error.response?.status}`);
        }
      }
    }
    
  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error('❌ HTTP Error:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        url: error.config?.url,
        method: error.config?.method,
        data: error.response?.data
      });
      
      // Specific error handling
      if (error.response?.status === 400) {
        logger.error('🔍 This usually means invalid client credentials or malformed request');
        
        // Check if the error response has details
        if (error.response.data) {
          logger.error('Error details:', error.response.data);
        }
      } else if (error.response?.status === 401) {
        logger.error('🔍 Authentication failed - check your client_id and client_secret');
      } else if (error.code === 'ECONNREFUSED') {
        logger.error('🔍 Connection refused - check your internet connection');
      } else if (error.code === 'ETIMEDOUT') {
        logger.error('🔍 Request timed out - network or server issue');
      }
    } else {
      logger.error('❌ Non-HTTP Error:', error);
    }
  }
}

// Test the existing service function
async function testService() {
  logger.info('\n=== TESTING SERVICE FUNCTION ===');
  try {
    const result = await testBitwardenConnection();
    logger.info(result ? '✅ Service test passed' : '❌ Service test failed');
  } catch (error) {
    logger.error('❌ Service test error:', error);
  }
}

async function main() {
  await debugBitwardenAuth();
  await testService();
}

main().catch(console.error);