import * as cron from 'node-cron';
import { getOrganizationMembers, confirmMember } from './bitwarden';
import { logger } from '../utils/logger';

export interface PendingMember {
  id: string;
  email: string;
  name?: string;
  status: number;
  type: number;
}

// Main function to process pending member confirmations
export async function processPendingConfirmations(): Promise<void> {
  logger.info('Starting scheduled job: Processing pending member confirmations');

  try {
    // Fetch all organization members
    const members = await getOrganizationMembers();
    
    // Filter for members that need confirmation (status 0 = invited, status 1 = accepted)
    const pendingMembers = members.filter((member: PendingMember) => 
      member.status === 1 // Status 1 means "Accepted" but not yet confirmed
    );

    logger.info(`Found ${pendingMembers.length} members pending confirmation out of ${members.length} total members`);

    if (pendingMembers.length === 0) {
      logger.info('No pending confirmations to process');
      return;
    }

    // Process each pending member
    const results = {
      confirmed: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const member of pendingMembers) {
      logger.info(`Processing confirmation for member: ${member.email} (ID: ${member.id})`);
      
      try {
        const confirmed = await confirmMember(member.id);
        
        if (confirmed) {
          results.confirmed++;
          logger.info(`✅ Successfully confirmed: ${member.email}`);
        } else {
          results.failed++;
          results.errors.push(`Failed to confirm ${member.email}`);
          logger.warn(`❌ Failed to confirm: ${member.email}`);
        }
        
        // Add a small delay between confirmations to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        results.failed++;
        const errorMsg = `Error confirming ${member.email}: ${error}`;
        results.errors.push(errorMsg);
        logger.error(errorMsg);
      }
    }

    // Log summary
    logger.info(`Scheduled job completed. Confirmed: ${results.confirmed}, Failed: ${results.failed}`);
    
    if (results.errors.length > 0) {
      logger.warn('Errors during confirmation process:', results.errors);
    }

  } catch (error) {
    logger.error('Error in scheduled confirmation job:', error);
  }
}

// Setup scheduled jobs
export function setupScheduledJobs(): void {
  // Run every 30 minutes during business hours (9 AM - 6 PM, Monday-Friday)
  // Cron format: minute hour day-of-month month day-of-week
  const schedule = '*/30 9-18 * * 1-5'; // Every 30 minutes, 9 AM to 6 PM, Monday to Friday

  logger.info(`Setting up scheduled job with cron pattern: ${schedule}`);

  cron.schedule(schedule, async () => {
    await processPendingConfirmations();
  }, {
    scheduled: true,
    timezone: "Australia/Melbourne" // Adjust to your timezone
  });

  // Also run a less frequent job for weekends/after hours (every 2 hours)
  const afterHoursSchedule = '0 */2 * * *'; // Every 2 hours
  
  cron.schedule(afterHoursSchedule, async () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // Only run if it's outside business hours (before 9 AM, after 6 PM, or weekends)
    if (hour < 9 || hour >= 18 || day === 0 || day === 6) {
      logger.info('Running after-hours confirmation check');
      await processPendingConfirmations();
    }
  }, {
    scheduled: true,
    timezone: "Australia/Melbourne"
  });

  logger.info('Scheduled jobs initialized successfully');
}

// Function to run the job manually (useful for testing)
export async function runConfirmationJobNow(): Promise<void> {
  logger.info('Manually triggering confirmation job');
  await processPendingConfirmations();
}

// Get current job status (useful for monitoring)
export function getSchedulerStatus(): { 
  activeJobs: number; 
  nextBusinessHoursRun: Date | null;
  nextAfterHoursRun: Date | null;
} {
  const tasks = cron.getTasks();
  const activeJobs = tasks.size;
  
  // This is a simplified status - in a production environment, 
  // you might want to implement more detailed job tracking
  return {
    activeJobs,
    nextBusinessHoursRun: null, // Would need to calculate based on cron schedule
    nextAfterHoursRun: null
  };
}