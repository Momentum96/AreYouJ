import { ClaudeSessionManager } from '../claude/session-manager.js';
import { v4 as uuidv4 } from 'uuid';
import EventEmitter from 'events';
import path from 'path';
import sqliteManager from '../db/sqlite.js';

/**
 * SessionOrchestrator - Dynamic Session Orchestration Architecture
 * 
 * Manages multiple Claude sessions dynamically with:
 * - UUID-based session identification
 * - No-timeout persistence 
 * - Working directory isolation
 * - Dynamic creation/termination
 * - Comprehensive state monitoring
 */
export class SessionOrchestrator extends EventEmitter {
  constructor() {
    super();
    
    // Core session management
    this.activeSessions = new Map(); // sessionId -> { session, metadata }
    this.sessionMetrics = new Map();  // sessionId -> performance metrics
    
    // Configuration
    this.maxConcurrentSessions = 10; // Prevent resource exhaustion
    this.sessionHealthCheckInterval = 30000; // 30 seconds
    this.metricsRetentionLimit = 1000; // Keep last 1000 metric entries
    
    // State tracking
    this.isInitialized = false;
    this.healthCheckTimer = null;
    this.creationInProgress = new Set(); // Track sessions being created
    
    this.log('SessionOrchestrator initialized');
    this.startHealthChecking();
  }

  /**
   * Create a new Claude session with specified configuration
   * @param {string} workingDirectory - Target working directory
   * @param {Object} userConfig - Session configuration options
   * @returns {Promise<string>} - Generated session ID
   */
  async createSession(workingDirectory, userConfig = {}) {
    const sessionId = uuidv4();
    
    try {
      // Validate working directory
      if (!workingDirectory || typeof workingDirectory !== 'string') {
        throw new Error('Valid working directory is required');
      }
      
      // Check session limits
      if (this.activeSessions.size >= this.maxConcurrentSessions) {
        throw new Error(`Maximum concurrent sessions reached (${this.maxConcurrentSessions})`);
      }
      
      // Check if session creation is already in progress for this directory
      const existingSessionForDir = this.findSessionByWorkingDirectory(workingDirectory);
      if (existingSessionForDir) {
        this.log(`Session already exists for directory: ${workingDirectory}, returning existing ID: ${existingSessionForDir.id}`);
        return existingSessionForDir.id;
      }
      
      // Mark creation in progress
      this.creationInProgress.add(sessionId);
      this.log(`Creating new session ${sessionId} for directory: ${workingDirectory}`);
      
      // Create new ClaudeSessionManager instance with clean state
      // Skip initial queue loading to prevent contamination from legacy sessions
      const sessionManager = new ClaudeSessionManager({
        skipInitialQueueLoad: true,
        skipWorkingDirectoryLoad: true
      });
      
      // Configure session for the specified working directory
      sessionManager.setWorkingDirectory(workingDirectory);
      
      // Apply user configuration
      if (userConfig.outputThrottleMs) {
        sessionManager.OUTPUT_THROTTLE_MS = userConfig.outputThrottleMs;
      }
      if (userConfig.outputAutoClearMs) {
        sessionManager.OUTPUT_AUTO_CLEAR_MS = userConfig.outputAutoClearMs;
      }
      
      // Create session metadata
      const sessionMetadata = {
        id: sessionId,
        workingDirectory: path.resolve(workingDirectory),
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        status: 'initializing',
        userConfig: { ...userConfig },
        messageCount: 0,
        totalProcessingTime: 0,
        errorCount: 0
      };

      // Save session to database
      try {
        // Initialize database if not already done
        if (!sqliteManager.getDB()) {
          await sqliteManager.initDB(sessionMetadata.workingDirectory);
        }
        
        await sqliteManager.createSession({
          id: sessionId,
          workingDirectory: sessionMetadata.workingDirectory,
          status: 'initializing',
          userConfig: sessionMetadata.userConfig,
          metadata: sessionMetadata
        });
      } catch (dbError) {
        this.log(`❌ Failed to save session ${sessionId} to database: ${dbError.message}`);
        // Continue with in-memory session creation even if DB save fails
      }
      
      // Setup session event forwarding
      this.setupSessionEventForwarding(sessionManager, sessionId, sessionMetadata);
      
      // Store session before starting to prevent race conditions
      this.activeSessions.set(sessionId, {
        session: sessionManager,
        metadata: sessionMetadata
      });
      
      // Start Claude session
      const startSuccess = await sessionManager.startSession(userConfig.skipPermissions !== false);
      
      if (!startSuccess) {
        // Remove failed session
        this.activeSessions.delete(sessionId);
        this.creationInProgress.delete(sessionId);
        throw new Error('Failed to start Claude session');
      }
      
      // Update metadata after successful start
      sessionMetadata.status = 'active';
      sessionMetadata.startedAt = new Date().toISOString();
      
      // Update session status in database
      try {
        await sqliteManager.updateSession(sessionId, {
          status: 'active',
          started_at: sessionMetadata.startedAt,
          last_activity: sessionMetadata.lastActivity
        });
      } catch (dbError) {
        this.log(`❌ Failed to update session ${sessionId} status in database: ${dbError.message}`);
      }
      
      this.creationInProgress.delete(sessionId);
      
      this.log(`✅ Session ${sessionId} created and started successfully`);
      this.emit('session-created', { sessionId, metadata: sessionMetadata });
      
      // Trigger session list update for real-time UI updates
      this.emitSessionListUpdate();
      
      return sessionId;
      
    } catch (error) {
      this.creationInProgress.delete(sessionId);
      this.activeSessions.delete(sessionId);
      
      this.log(`❌ Failed to create session ${sessionId}: ${error.message}`);
      this.emit('session-creation-failed', { sessionId, error: error.message, workingDirectory });
      
      throw new Error(`Session creation failed: ${error.message}`);
    }
  }

  /**
   * Terminate a specific session
   * @param {string} sessionId - Session ID to terminate
   * @returns {Promise<boolean>} - Success status
   */
  async terminateSession(sessionId) {
    try {
      const sessionData = this.activeSessions.get(sessionId);
      
      if (!sessionData) {
        this.log(`❌ Session ${sessionId} not found for termination`);
        return false;
      }
      
      const { session, metadata } = sessionData;
      
      this.log(`🛑 Terminating session ${sessionId}`);
      metadata.status = 'terminating';
      metadata.terminatingAt = new Date().toISOString();
      
      // Stop the Claude session
      await session.stop();
      
      // Remove from active sessions
      this.activeSessions.delete(sessionId);
      
      // Update session status in database
      try {
        await sqliteManager.updateSession(sessionId, {
          status: 'terminated',
          terminated_at: metadata.terminatingAt,
          last_activity: metadata.terminatingAt,
          message_count: metadata.messageCount,
          total_processing_time: metadata.totalProcessingTime,
          error_count: metadata.errorCount
        });
      } catch (dbError) {
        this.log(`❌ Failed to update terminated session ${sessionId} in database: ${dbError.message}`);
      }
      
      // Archive metrics
      this.archiveSessionMetrics(sessionId, metadata);
      
      this.log(`✅ Session ${sessionId} terminated successfully`);
      this.emit('session-terminated', { sessionId, metadata });
      
      // Trigger session list update for real-time UI updates
      this.emitSessionListUpdate();
      
      return true;
      
    } catch (error) {
      this.log(`❌ Error terminating session ${sessionId}: ${error.message}`);
      this.emit('session-termination-failed', { sessionId, error: error.message });
      
      return false;
    }
  }

  /**
   * Get all active sessions
   * @returns {Array} - Array of session summaries
   */
  getAllActiveSessions() {
    const sessions = [];
    
    for (const [sessionId, { session, metadata }] of this.activeSessions) {
      sessions.push({
        id: sessionId,
        workingDirectory: metadata.workingDirectory,
        status: metadata.status,
        createdAt: metadata.createdAt,
        lastActivity: metadata.lastActivity,
        messageCount: metadata.messageCount,
        sessionReady: session.sessionReady,
        currentlyProcessing: session.currentlyProcessing?.id || null,
        queueLength: session.messageQueue?.length || 0
      });
    }
    
    return sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * Get detailed information about a specific session
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Session details or null if not found
   */
  getSessionDetails(sessionId) {
    const sessionData = this.activeSessions.get(sessionId);
    
    if (!sessionData) {
      return null;
    }
    
    const { session, metadata } = sessionData;
    const sessionStatus = session.getStatus();
    
    return {
      id: sessionId,
      metadata: { ...metadata },
      sessionStatus: sessionStatus,
      messageQueue: session.getMessageQueue(),
      metrics: this.sessionMetrics.get(sessionId) || [],
      performance: {
        totalProcessingTime: metadata.totalProcessingTime,
        averageProcessingTime: metadata.messageCount > 0 
          ? Math.round(metadata.totalProcessingTime / metadata.messageCount) 
          : 0,
        errorRate: metadata.messageCount > 0 
          ? Math.round((metadata.errorCount / metadata.messageCount) * 100) 
          : 0
      }
    };
  }

  /**
   * Get session by working directory (for reuse detection)
   * @private
   */
  findSessionByWorkingDirectory(workingDirectory) {
    const resolvedPath = path.resolve(workingDirectory);
    
    for (const [sessionId, { metadata }] of this.activeSessions) {
      if (metadata.workingDirectory === resolvedPath && metadata.status === 'active') {
        return { id: sessionId, metadata };
      }
    }
    
    return null;
  }

  /**
   * Setup event forwarding from individual sessions to orchestrator
   * @private
   */
  setupSessionEventForwarding(sessionManager, sessionId, metadata) {
    // Forward session events with session context
    sessionManager.on('session-started', () => {
      const oldStatus = metadata.status;
      metadata.lastActivity = new Date().toISOString();
      metadata.status = 'active';
      
      // Emit session status change event
      this.emit('session-status-changed', { 
        sessionId, 
        oldStatus, 
        newStatus: 'active',
        metadata: { ...metadata },
        timestamp: metadata.lastActivity 
      });
      
      this.emit('session-event', { sessionId, event: 'session-started', timestamp: metadata.lastActivity });
      
      // Trigger session list update
      this.emitSessionListUpdate();
    });
    
    sessionManager.on('session-ended', (data) => {
      const oldStatus = metadata.status;
      metadata.status = 'ended';
      metadata.endedAt = new Date().toISOString();
      
      // Emit session status change event
      this.emit('session-status-changed', { 
        sessionId, 
        oldStatus, 
        newStatus: 'ended',
        metadata: { ...metadata },
        timestamp: metadata.endedAt 
      });
      
      this.emit('session-event', { sessionId, event: 'session-ended', data, timestamp: metadata.endedAt });
      
      // Trigger session list update
      this.emitSessionListUpdate();
    });
    
    sessionManager.on('message-started', (message) => {
      const oldStatus = metadata.status;
      metadata.lastActivity = new Date().toISOString();
      metadata.messageCount++;
      metadata.status = 'busy';
      
      // Emit session status change event (idle/active -> busy)
      if (oldStatus !== 'busy') {
        this.emit('session-status-changed', { 
          sessionId, 
          oldStatus, 
          newStatus: 'busy',
          currentTask: message.message || 'Processing message...',
          metadata: { ...metadata },
          timestamp: metadata.lastActivity 
        });
      }
      
      this.emit('session-event', { sessionId, event: 'message-started', message, timestamp: metadata.lastActivity });
    });
    
    sessionManager.on('message-completed', (message) => {
      const oldStatus = metadata.status;
      metadata.lastActivity = new Date().toISOString();
      
      // Track processing time
      if (message.processingTimeMs) {
        metadata.totalProcessingTime += message.processingTimeMs;
      }
      
      // Track errors
      if (message.status === 'error') {
        metadata.errorCount++;
      }
      
      // Store metric data
      this.storeSessionMetric(sessionId, {
        type: 'message-completed',
        timestamp: metadata.lastActivity,
        processingTimeMs: message.processingTimeMs,
        status: message.status,
        messageId: message.id
      });
      
      // Change status from busy to idle after message completion
      metadata.status = 'idle';
      
      // Emit session status change event (busy -> idle)
      if (oldStatus !== 'idle') {
        this.emit('session-status-changed', { 
          sessionId, 
          oldStatus, 
          newStatus: 'idle',
          currentTask: null,
          metadata: { ...metadata },
          timestamp: metadata.lastActivity 
        });
      }
      
      this.emit('session-event', { sessionId, event: 'message-completed', message, timestamp: metadata.lastActivity });
    });
    
    sessionManager.on('claude-output', (output) => {
      metadata.lastActivity = new Date().toISOString();
      this.emit('session-output', { sessionId, output, timestamp: metadata.lastActivity });
    });
    
    sessionManager.on('session-unhealthy', () => {
      metadata.status = 'unhealthy';
      metadata.lastActivity = new Date().toISOString();
      this.emit('session-event', { sessionId, event: 'session-unhealthy', timestamp: metadata.lastActivity });
    });
  }

  /**
   * Store performance metrics for a session
   * @private
   */
  storeSessionMetric(sessionId, metric) {
    if (!this.sessionMetrics.has(sessionId)) {
      this.sessionMetrics.set(sessionId, []);
    }
    
    const metrics = this.sessionMetrics.get(sessionId);
    metrics.push(metric);
    
    // Limit retention to prevent memory leaks
    if (metrics.length > this.metricsRetentionLimit) {
      metrics.splice(0, metrics.length - this.metricsRetentionLimit);
    }
  }

  /**
   * Archive session metrics when session terminates
   * @private
   */
  archiveSessionMetrics(sessionId, metadata) {
    const metrics = this.sessionMetrics.get(sessionId);
    if (metrics && metrics.length > 0) {
      // Could save to database or file here for long-term analysis
      this.log(`📊 Archived ${metrics.length} metrics for session ${sessionId}`);
    }
    
    // Remove from memory
    this.sessionMetrics.delete(sessionId);
  }

  /**
   * Emit session-list-update event with current session statistics
   * This is used by WebSocket clients to update their session lists in real-time
   * @private
   */
  emitSessionListUpdate() {
    const allSessions = this.getAllActiveSessions();
    const stats = this.getOrchestratorStats();
    
    // Calculate status distribution
    const statusDistribution = {
      active: 0,
      idle: 0,
      busy: 0,
      unhealthy: 0,
      restored: 0,
      terminated: 0,
      initializing: 0
    };
    
    allSessions.forEach(session => {
      if (statusDistribution.hasOwnProperty(session.status)) {
        statusDistribution[session.status]++;
      }
    });
    
    const sessionListData = {
      sessions: allSessions,
      statistics: {
        total: stats.activeSessions,
        ...statusDistribution,
        totalMessages: stats.totalMessages,
        totalProcessingTime: stats.totalProcessingTime,
        averageProcessingTime: stats.averageProcessingTime
      },
      timestamp: new Date().toISOString()
    };
    
    // Emit session-list-update event for WebSocket broadcasting
    this.emit('session-list-update', sessionListData);
    
    this.log(`📡 Session list update emitted: ${allSessions.length} sessions`);
  }

  /**
   * Start health checking for all sessions
   * @private
   */
  startHealthChecking() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.sessionHealthCheckInterval);
    
    this.log('🏥 Health checking started');
  }

  /**
   * Perform health check on all active sessions
   * @private
   */
  performHealthCheck() {
    for (const [sessionId, { session, metadata }] of this.activeSessions) {
      try {
        const status = session.getStatus();
        
        // Check if session is still alive
        if (!status.processAlive && metadata.status === 'active') {
          this.log(`⚠️ Session ${sessionId} process died, marking as unhealthy`);
          metadata.status = 'unhealthy';
          this.emit('session-event', { sessionId, event: 'health-check-failed', timestamp: new Date().toISOString() });
        }
        
        // Update last activity if session is processing
        if (status.currentlyProcessing) {
          metadata.lastActivity = new Date().toISOString();
        }
        
      } catch (error) {
        this.log(`❌ Health check failed for session ${sessionId}: ${error.message}`);
        metadata.status = 'unhealthy';
        this.emit('session-event', { sessionId, event: 'health-check-error', error: error.message, timestamp: new Date().toISOString() });
      }
    }
  }

  /**
   * Get orchestrator statistics
   */
  getOrchestratorStats() {
    const activeCount = this.activeSessions.size;
    const healthyCount = Array.from(this.activeSessions.values())
      .filter(({ metadata }) => metadata.status === 'active').length;
    
    const totalMessages = Array.from(this.activeSessions.values())
      .reduce((sum, { metadata }) => sum + metadata.messageCount, 0);
    
    const totalProcessingTime = Array.from(this.activeSessions.values())
      .reduce((sum, { metadata }) => sum + metadata.totalProcessingTime, 0);
    
    return {
      activeSessions: activeCount,
      healthySessions: healthyCount,
      totalMessages: totalMessages,
      totalProcessingTime: totalProcessingTime,
      averageProcessingTime: totalMessages > 0 ? Math.round(totalProcessingTime / totalMessages) : 0,
      memoryUsage: {
        activeSessionsMemory: activeCount,
        metricsMemory: Array.from(this.sessionMetrics.values()).reduce((sum, metrics) => sum + metrics.length, 0)
      }
    };
  }

  /**
   * Get session by ID (for direct access)
   */
  getSession(sessionId) {
    const sessionData = this.activeSessions.get(sessionId);
    return sessionData ? sessionData.session : null;
  }

  /**
   * Restore sessions from database on server restart
   * @returns {Promise<number>} - Number of sessions restored
   */
  async restoreSessionsFromDatabase() {
    try {
      this.log('🔄 Restoring sessions from database...');
      
      const activeSessions = await sqliteManager.getActiveSessions();
      let restoredCount = 0;
      
      for (const sessionRecord of activeSessions) {
        try {
          const sessionId = sessionRecord.id;
          const workingDirectory = sessionRecord.working_directory;
          
          // Check if session already exists in memory
          if (this.activeSessions.has(sessionId)) {
            this.log(`⚠️ Session ${sessionId} already exists in memory, skipping restore`);
            continue;
          }
          
          // Check if working directory still exists
          const fs = await import('fs');
          if (!fs.existsSync(workingDirectory)) {
            this.log(`⚠️ Working directory ${workingDirectory} no longer exists, marking session ${sessionId} as terminated`);
            await sqliteManager.updateSession(sessionId, {
              status: 'terminated',
              terminated_at: new Date().toISOString()
            });
            continue;
          }
          
          // Create SessionOrchestrator session entry (without starting Claude process)
          const sessionMetadata = {
            id: sessionId,
            workingDirectory: workingDirectory,
            createdAt: sessionRecord.created_at,
            lastActivity: sessionRecord.last_activity,
            status: 'restored',
            userConfig: sessionRecord.userConfig || {},
            messageCount: sessionRecord.message_count || 0,
            totalProcessingTime: sessionRecord.total_processing_time || 0,
            errorCount: sessionRecord.error_count || 0,
            restoredAt: new Date().toISOString()
          };
          
          // Note: We don't create ClaudeSessionManager here as the process is likely dead
          // Instead, mark session as "restored" and let it be recreated when needed
          this.activeSessions.set(sessionId, {
            session: null, // Will be created on first use
            metadata: sessionMetadata
          });
          
          // Update database status
          await sqliteManager.updateSession(sessionId, {
            status: 'restored',
            last_activity: sessionMetadata.restoredAt
          });
          
          restoredCount++;
          this.log(`✅ Session ${sessionId} restored from database (dir: ${workingDirectory})`);
          
        } catch (sessionError) {
          this.log(`❌ Failed to restore session ${sessionRecord.id}: ${sessionError.message}`);
        }
      }
      
      this.log(`🎯 Restored ${restoredCount} sessions from database`);
      this.emit('sessions-restored', { count: restoredCount });
      
      return restoredCount;
      
    } catch (error) {
      this.log(`❌ Failed to restore sessions from database: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get database session statistics
   * @returns {Promise<Object>} - Session statistics from database
   */
  async getDatabaseSessionStats() {
    try {
      return await sqliteManager.getSessionStats();
    } catch (error) {
      this.log(`❌ Failed to get database session stats: ${error.message}`);
      throw error;
    }
  }

  /**
   * Cleanup all sessions and resources
   */
  async cleanup() {
    this.log('🧹 Starting SessionOrchestrator cleanup');
    
    // Stop health checking
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
    
    // Terminate all active sessions
    const terminationPromises = [];
    for (const sessionId of this.activeSessions.keys()) {
      terminationPromises.push(this.terminateSession(sessionId));
    }
    
    await Promise.allSettled(terminationPromises);
    
    // Clear all data
    this.activeSessions.clear();
    this.sessionMetrics.clear();
    this.creationInProgress.clear();
    
    this.log('✅ SessionOrchestrator cleanup completed');
  }

  /**
   * Private logging method
   * @private
   */
  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [SessionOrchestrator] ${message}`);
  }
}

// Singleton instance for global access
let sessionOrchestrator = null;

/**
 * Get the global SessionOrchestrator instance
 * @returns {SessionOrchestrator}
 */
export function getSessionOrchestrator() {
  if (!sessionOrchestrator) {
    sessionOrchestrator = new SessionOrchestrator();
  }
  return sessionOrchestrator;
}