import cron from 'node-cron';
import { logger } from '../utils/logger';
import { getAllVaultwardenUsers, deleteVaultwardenUser } from '../services/bitwarden';

interface ScheduledJobResult {
  totalUsers: number;
  activeUsers: number;
  inactiveUsers: number;
  deleted: number;
  errors: string[];
}

/**
 * Clean up inactive or unconfirmed users
 * This runs periodically to maintain the Vaultwarden instance
 */
async function cleanupInactiveUsers(): Promise<ScheduledJobResult> {
  logger.info('🧹 Starting scheduled cleanup of inactive Vaultwarden users...');
  
  const result: ScheduledJobResult = {
    totalUsers: 0,
    activeUsers: 0,
    inactiveUsers: 0,
    deleted: 0,
    errors: []
  };

  try {
    // Get all users from Vaultwarden
    const allUsers = await getAllVaultwardenUsers();
    result.totalUsers = allUsers.length;
    
    logger.info(`📊 Found ${allUsers.length} total users in Vaultwarden`);

    if (allUsers.length === 0) {
      logger.info('No users found to process');
      return result;
    }

    // Define criteria for inactive users
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));

    // Process each user
    for (const user of allUsers) {
      try {
        const createdAt = user.CreatedAt ? new Date(user.CreatedAt) : null;
        const lastActive = user.LastActive ? new Date(user.LastActive) : null;
        const isEnabled = user.UserEnabled !== false;
        const hasPassword = user.PasswordHash && user.PasswordHash.length > 0;

        logger.info(`👤 Processing user: ${user.Email}`);
        logger.info(`   Created: ${createdAt?.toISOString() || 'Unknown'}`);
        logger.info(`   Last Active: ${lastActive?.toISOString() || 'Never'}`);
        logger.info(`   Enabled: ${isEnabled}, Has Password: ${hasPassword}`);

        let shouldDelete = false;
        let reason = '';

        // Criteria 1: Users who never set a password after 7 days
        if (!hasPassword && createdAt && createdAt < sevenDaysAgo) {
          shouldDelete = true;
          reason = 'Never set password after 7 days';
        }
        
        // Criteria 2: Disabled users inactive for 30+ days
        else if (!isEnabled && lastActive && lastActive < thirtyDaysAgo) {
          shouldDelete = true;
          reason = 'Disabled and inactive for 30+ days';
        }
        
        // Criteria 3: Users with no activity for 90+ days (more conservative)
        else if (lastActive && lastActive < new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000))) {
          shouldDelete = true;
          reason = 'No activity for 90+ days';
        }

        if (shouldDelete) {
          logger.info(`🗑️  Deleting user ${user.Email}: ${reason}`);
          
          const deleted = await deleteVaultwardenUser(user.Id);
          
          if (deleted) {
            result.deleted++;
            logger.info(`✅ Successfully deleted ${user.Email}`);
          } else {
            result.errors.push(`Failed to delete ${user.Email}`);
            logger.error(`❌ Failed to delete ${user.Email}`);
          }
          
          result.inactiveUsers++;
        } else {
          result.activeUsers++;
          logger.info(`✅ Keeping active user: ${user.Email}`);
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (userError) {
        const errorMsg = `Error processing user ${user.Email}: ${userError}`;
        result.errors.push(errorMsg);
        logger.error(errorMsg);
      }
    }

    logger.info('🧹 Cleanup completed');
    logger.info(`📊 Summary: ${result.totalUsers} total, ${result.activeUsers} active, ${result.deleted} deleted`);

    return result;

  } catch (error) {
    logger.error('❌ Error in scheduled cleanup:', error);
    result.errors.push(`Cleanup process error: ${error}`);
    return result;
  }
}

/**
 * Generate usage report for administrators
 */
async function generateUsageReport(): Promise<void> {
  logger.info('📊 Generating Vaultwarden usage report...');
  
  try {
    const allUsers = await getAllVaultwardenUsers();
    
    // Analyze user statistics
    const stats = {
      totalUsers: allUsers.length,
      enabledUsers: allUsers.filter(u => u.UserEnabled !== false).length,
      disabledUsers: allUsers.filter(u => u.UserEnabled === false).length,
      usersWithPasswords: allUsers.filter(u => u.PasswordHash && u.PasswordHash.length > 0).length,
      recentlyActive: 0,
      neverActive: 0
    };

    const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
    
    for (const user of allUsers) {
      const lastActive = user.LastActive ? new Date(user.LastActive) : null;
      
      if (!lastActive) {
        stats.neverActive++;
      } else if (lastActive > sevenDaysAgo) {
        stats.recentlyActive++;
      }
    }

    // Log comprehensive report
    logger.info('📈 VAULTWARDEN USAGE REPORT');
    logger.info('===============================');
    logger.info(`Total Users: ${stats.totalUsers}`);
    logger.info(`Enabled Users: ${stats.enabledUsers}`);
    logger.info(`Disabled Users: ${stats.disabledUsers}`);
    logger.info(`Users with Passwords: ${stats.usersWithPasswords}`);
    logger.info(`Recently Active (7 days): ${stats.recentlyActive}`);
    logger.info(`Never Active: ${stats.neverActive}`);
    logger.info('===============================');

    // Log user breakdown by team (if available in user data)
    const teamStats: Record<string, number> = {};
    for (const user of allUsers) {
      // Extract team from name or email if possible
      const team = extractTeamFromUser(user);
      teamStats[team] = (teamStats[team] || 0) + 1;
    }

    if (Object.keys(teamStats).length > 1) {
      logger.info('👥 TEAM BREAKDOWN:');
      Object.entries(teamStats)
        .sort(([,a], [,b]) => b - a)
        .forEach(([team, count]) => {
          logger.info(`   ${team}: ${count} users`);
        });
    }

  } catch (error) {
    logger.error('❌ Error generating usage report:', error);
  }
}

/**
 * Extract team information from user data
 */
function extractTeamFromUser(user: any): string {
  // Try to extract team from email domain or name
  if (user.Email) {
    // If email contains team info (e.g., john.doe+team@domain.com)
    const emailMatch = user.Email.match(/\+([^@]+)@/);
    if (emailMatch) {
      return emailMatch[1];
    }
    
    // Use domain as team identifier
    const domain = user.Email.split('@')[1];
    if (domain && domain !== 'gmail.com' && domain !== 'outlook.com') {
      return domain;
    }
  }
  
  return 'Unknown';
}

/**
 * Start all scheduled jobs
 */
export function startScheduledJobs(): void {
  logger.info('🕒 Starting scheduled jobs for Vaultwarden management...');

  // Daily cleanup at 2 AM
  cron.schedule('0 2 * * *', async () => {
    logger.info('⏰ Running daily cleanup job...');
    try {
      const result = await cleanupInactiveUsers();
      
      if (result.errors.length > 0) {
        logger.warn(`⚠️  Cleanup completed with ${result.errors.length} errors`);
        result.errors.forEach(error => logger.error(`   - ${error}`));
      } else {
        logger.info('✅ Daily cleanup completed successfully');
      }
    } catch (error) {
      logger.error('❌ Daily cleanup job failed:', error);
    }
  }, {
    timezone: 'Australia/Melbourne' // Adjust to your timezone
  });

  // Weekly usage report on Mondays at 9 AM
  cron.schedule('0 9 * * 1', async () => {
    logger.info('⏰ Running weekly usage report...');
    try {
      await generateUsageReport();
      logger.info('✅ Weekly usage report completed');
    } catch (error) {
      logger.error('❌ Weekly usage report failed:', error);
    }
  }, {
    timezone: 'Australia/Melbourne'
  });

  // Health check every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    logger.info('⏰ Running health check...');
    try {
      const users = await getAllVaultwardenUsers();
      logger.info(`💚 Health check: Vaultwarden accessible, ${users.length} total users`);
    } catch (error) {
      logger.error('❌ Health check failed:', error);
    }
  });

  logger.info('✅ Scheduled jobs started:');
  logger.info('   📅 Daily cleanup: 2:00 AM AEDT');
  logger.info('   📊 Weekly report: Monday 9:00 AM AEDT'); 
  logger.info('   💚 Health check: Every 6 hours');
}

/**
 * Run cleanup manually (for testing or immediate cleanup)
 */
export async function runManualCleanup(): Promise<ScheduledJobResult> {
  logger.info('🧹 Running manual cleanup...');
  return await cleanupInactiveUsers();
}

/**
 * Run usage report manually
 */
export async function runManualReport(): Promise<void> {
  logger.info('📊 Running manual usage report...');
  await generateUsageReport();
}