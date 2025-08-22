import { SessionOrchestrator } from '../session-orchestrator.js';
import { jest } from '@jest/globals';

// Mock the ClaudeSessionManager to avoid actual Claude process spawn
jest.mock('../../claude/session-manager.js', () => ({
  ClaudeSessionManager: jest.fn().mockImplementation(() => ({
    setWorkingDirectory: jest.fn(),
    startSession: jest.fn().mockResolvedValue(true),
    stop: jest.fn().mockResolvedValue(true),
    getStatus: jest.fn().mockReturnValue({
      sessionReady: true,
      isStarting: false,
      currentlyProcessing: null,
      processAlive: true,
      screenBufferSize: 0
    }),
    getMessageQueue: jest.fn().mockReturnValue([]),
    sessionReady: true,
    currentlyProcessing: null,
    messageQueue: [],
    on: jest.fn(),
    OUTPUT_THROTTLE_MS: 1000,
    OUTPUT_AUTO_CLEAR_MS: 30000
  }))
}));

describe('SessionOrchestrator', () => {
  let orchestrator;

  beforeEach(() => {
    orchestrator = new SessionOrchestrator();
    // Clear any existing timers
    jest.clearAllTimers();
  });

  afterEach(async () => {
    if (orchestrator) {
      await orchestrator.cleanup();
    }
    jest.clearAllTimers();
  });

  describe('Session Creation', () => {
    test('should create a new session with valid working directory', async () => {
      const workingDir = '/test/directory';
      const sessionId = await orchestrator.createSession(workingDir);

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');
      expect(sessionId.length).toBe(36); // UUID v4 length
    });

    test('should reject invalid working directory', async () => {
      await expect(orchestrator.createSession(null)).rejects.toThrow('Valid working directory is required');
      await expect(orchestrator.createSession('')).rejects.toThrow('Valid working directory is required');
      await expect(orchestrator.createSession(123)).rejects.toThrow('Valid working directory is required');
    });

    test('should reuse existing session for same working directory', async () => {
      const workingDir = '/test/directory';
      
      const sessionId1 = await orchestrator.createSession(workingDir);
      const sessionId2 = await orchestrator.createSession(workingDir);
      
      expect(sessionId1).toBe(sessionId2);
    });

    test('should apply user configuration', async () => {
      const workingDir = '/test/directory';
      const userConfig = {
        outputThrottleMs: 500,
        outputAutoClearMs: 15000,
        skipPermissions: false
      };

      const sessionId = await orchestrator.createSession(workingDir, userConfig);
      const details = orchestrator.getSessionDetails(sessionId);
      
      expect(details.metadata.userConfig).toEqual(userConfig);
    });
  });

  describe('Session Management', () => {
    test('should list all active sessions', async () => {
      const workingDir1 = '/test/directory1';
      const workingDir2 = '/test/directory2';

      const sessionId1 = await orchestrator.createSession(workingDir1);
      const sessionId2 = await orchestrator.createSession(workingDir2);

      const activeSessions = orchestrator.getAllActiveSessions();
      
      expect(activeSessions).toHaveLength(2);
      expect(activeSessions[0].id).toBe(sessionId2); // Most recent first
      expect(activeSessions[1].id).toBe(sessionId1);
    });

    test('should get session details', async () => {
      const workingDir = '/test/directory';
      const sessionId = await orchestrator.createSession(workingDir);

      const details = orchestrator.getSessionDetails(sessionId);
      
      expect(details).toBeDefined();
      expect(details.id).toBe(sessionId);
      expect(details.metadata.workingDirectory).toContain(workingDir);
      expect(details.metadata.status).toBe('active');
      expect(details.sessionStatus).toBeDefined();
    });

    test('should return null for non-existent session details', () => {
      const details = orchestrator.getSessionDetails('non-existent-id');
      expect(details).toBeNull();
    });

    test('should terminate sessions', async () => {
      const workingDir = '/test/directory';
      const sessionId = await orchestrator.createSession(workingDir);

      const terminated = await orchestrator.terminateSession(sessionId);
      
      expect(terminated).toBe(true);
      expect(orchestrator.getAllActiveSessions()).toHaveLength(0);
    });

    test('should handle termination of non-existent session', async () => {
      const terminated = await orchestrator.terminateSession('non-existent-id');
      expect(terminated).toBe(false);
    });
  });

  describe('Session Limits', () => {
    test('should enforce maximum concurrent sessions', async () => {
      // Set a low limit for testing
      orchestrator.maxConcurrentSessions = 2;

      await orchestrator.createSession('/test/dir1');
      await orchestrator.createSession('/test/dir2');

      await expect(orchestrator.createSession('/test/dir3'))
        .rejects.toThrow('Maximum concurrent sessions reached (2)');
    });
  });

  describe('Event Handling', () => {
    test('should emit session-created event', async () => {
      const eventSpy = jest.fn();
      orchestrator.on('session-created', eventSpy);

      const sessionId = await orchestrator.createSession('/test/directory');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          metadata: expect.objectContaining({
            id: sessionId,
            status: 'active'
          })
        })
      );
    });

    test('should emit session-terminated event', async () => {
      const eventSpy = jest.fn();
      orchestrator.on('session-terminated', eventSpy);

      const sessionId = await orchestrator.createSession('/test/directory');
      await orchestrator.terminateSession(sessionId);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          metadata: expect.objectContaining({
            id: sessionId,
            status: 'terminating'
          })
        })
      );
    });
  });

  describe('Statistics', () => {
    test('should provide orchestrator statistics', async () => {
      await orchestrator.createSession('/test/dir1');
      await orchestrator.createSession('/test/dir2');

      const stats = orchestrator.getOrchestratorStats();
      
      expect(stats.activeSessions).toBe(2);
      expect(stats.healthySessions).toBe(2);
      expect(stats.totalMessages).toBe(0);
      expect(stats.memoryUsage).toBeDefined();
    });
  });

  describe('Cleanup', () => {
    test('should cleanup all resources', async () => {
      await orchestrator.createSession('/test/dir1');
      await orchestrator.createSession('/test/dir2');

      expect(orchestrator.getAllActiveSessions()).toHaveLength(2);

      await orchestrator.cleanup();

      expect(orchestrator.getAllActiveSessions()).toHaveLength(0);
    });
  });
});

describe('SessionOrchestrator Singleton', () => {
  test('should provide singleton instance', async () => {
    const { getSessionOrchestrator } = await import('../session-orchestrator.js');
    
    const instance1 = getSessionOrchestrator();
    const instance2 = getSessionOrchestrator();
    
    expect(instance1).toBe(instance2);
    
    // Cleanup
    await instance1.cleanup();
  });
});