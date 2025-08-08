import axios from 'axios';
import { config } from '../utils/config';
import { logger } from '../utils/logger';

export interface UserInfo {
  name: string;
  email: string;
  team: string;
  discordUsername?: string;
}

export async function lookupUserTeam(personalEmail: string): Promise<UserInfo | null> {
  try {
    const response = await axios.post(
      `https://api.notion.com/v1/databases/${config.notion.databaseId}/query`,
      {
        filter: {
          property: 'Personal Email', // Adjust this property name based on your Notion database
          email: {
            equals: personalEmail
          }
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${config.notion.token}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28'
        }
      }
    );

    const results = response.data.results;
    
    if (!results || results.length === 0) {
      logger.info(`No user found for email: ${personalEmail}`);
      return null;
    }

    // Get the first matching result
    const user = results[0];
    const properties = user.properties;

    // Extract user information - adjust property names based on your Notion database structure
    const userInfo: UserInfo = {
      name: extractTextProperty(properties.Name || properties.name || properties['Full Name']),
      email: personalEmail,
      team: extractTextProperty(properties.Team || properties.team || properties.Department),
      discordUsername: extractTextProperty(properties.Discord || properties.discord || properties['Discord Username'])
    };

    // Validate that we got the required fields
    if (!userInfo.name || !userInfo.team) {
      logger.warn(`Incomplete user data for ${personalEmail}:`, userInfo);
      // Still return the user info, but log the warning
    }

    return userInfo;

  } catch (error) {
    if (axios.isAxiosError(error)) {
      logger.error(`Notion API error for ${personalEmail}:`, {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data
      });
    } else {
      logger.error(`Error looking up user ${personalEmail}:`, error);
    }
    
    return null;
  }
}

// Helper function to extract text from Notion property objects
function extractTextProperty(property: any): string {
  if (!property) return '';
  
  // Handle different Notion property types
  if (property.title && property.title.length > 0) {
    return property.title[0].plain_text || '';
  }
  
  if (property.rich_text && property.rich_text.length > 0) {
    return property.rich_text[0].plain_text || '';
  }
  
  if (property.select) {
    return property.select.name || '';
  }
  
  if (property.email) {
    return property.email;
  }
  
  if (typeof property === 'string') {
    return property;
  }
  
  return '';
}

// Function to test the Notion connection (useful for debugging)
export async function testNotionConnection(): Promise<boolean> {
  try {
    const response = await axios.get(
      `https://api.notion.com/v1/databases/${config.notion.databaseId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.notion.token}`,
          'Notion-Version': '2022-06-28'
        }
      }
    );
    
    logger.info('Notion connection successful:', response.data.title);
    return true;
  } catch (error) {
    logger.error('Notion connection failed:', error);
    return false;
  }
}