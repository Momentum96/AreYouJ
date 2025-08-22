import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

// Database configuration constants
const DB_CONFIG = {
  // Security limits
  MAX_JSON_SIZE: 1024 * 1024, // 1MB JSON size limit
  MAX_QUERY_PARAMS: 100, // Maximum query parameters
  
  // Connection management
  IDLE_TIMEOUT: 30000, // 30 seconds idle timeout
  CONNECTION_RETRY_ATTEMPTS: 3,
  CONNECTION_RETRY_DELAY: 1000, // 1 second
  
  // Performance
  MAX_CONCURRENT_CONNECTIONS: 10,
  QUERY_TIMEOUT: 30000, // 30 seconds
  TRANSACTION_TIMEOUT: 60000, // 1 minute
  
  // Session limits
  MAX_SESSIONS_PER_USER: 50,
  MAX_MESSAGES_PER_SESSION: 10000
};

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Standardized error classes for consistent error handling
class DatabaseError extends Error {
  constructor(message, code = 'DATABASE_ERROR', details = null) {
    super(message);
    this.name = 'DatabaseError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class SessionError extends Error {
  constructor(message, sessionId = null, code = 'SESSION_ERROR', details = null) {
    super(message);
    this.name = 'SessionError';
    this.sessionId = sessionId;
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }
}

class ValidationError extends Error {
  constructor(message, field = null, value = null) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
    this.timestamp = new Date().toISOString();
  }
}

class SQLiteManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.connectionState = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'switching'
    this.pendingRequests = [];
    this.connectionTimeout = null;
    this.lastActivity = null;
    this.IDLE_TIMEOUT = DB_CONFIG.IDLE_TIMEOUT;
    this._setupProcessHandlers();
  }

  /**
   * Setup graceful shutdown handlers
   * @private
   */
  _setupProcessHandlers() {
    const gracefulShutdown = async (signal) => {
      console.log(`📁 Received ${signal}, closing database connection...`);
      try {
        await this.closeDB();
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });
  }

  /**
   * Initialize SQLite database connection with state management
   * @param {string} projectHomePath - Path to project home directory
   * @param {boolean} isSwitch - Whether this is a project switch
   * @returns {Promise<boolean>} - Success status
   */
  async initDB(projectHomePath, isSwitch = false) {
    const targetPath = path.join(projectHomePath, 'docs', 'tasks.db');
    
    // Prevent race conditions with atomic state checking
    if (this.connectionState === 'connecting' || this.connectionState === 'switching') {
      if (this.dbPath === targetPath) {
        return this._waitForConnection();
      }
      // If connecting to different path, wait for current connection to complete then proceed
      await this._waitForConnection();
    }

    // Atomically set the connection state
    const previousState = this.connectionState;
    this.connectionState = isSwitch ? 'switching' : 'connecting';
    
    // Clear any existing timer to prevent memory leaks during state transitions
    this._clearIdleTimer();

    try {
      this.dbPath = path.join(projectHomePath, 'docs', 'tasks.db');
      
      // Check if docs directory exists
      const docsDir = path.dirname(this.dbPath);
      if (!fs.existsSync(docsDir)) {
        throw new Error(`Project docs directory does not exist: ${docsDir}. Please create it manually or initialize with tasks first.`);
      }

      // Check if database file exists
      const dbExists = fs.existsSync(this.dbPath);
      
      return new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, async (err) => {
          if (err) {
            console.error('Failed to open SQLite database:', err);
            this.connectionState = 'disconnected';
            this._clearIdleTimer(); // Ensure timer is cleared on connection error
            this._rejectPendingRequests(err);
            reject(err);
            return;
          }
          
          console.log(`📁 SQLite database connected: ${this.dbPath}`);
          
          try {
            // If database is new, create schema
            if (!dbExists) {
              await this.createSchema();
            }
            
            this.connectionState = 'connected';
            this.lastActivity = Date.now();
            this._startIdleTimer();
            this._resolvePendingRequests();
            resolve(true);
          } catch (schemaError) {
            console.error('Schema creation failed:', schemaError);
            this.connectionState = 'disconnected';
            this._clearIdleTimer(); // Ensure timer is cleared on error
            this._rejectPendingRequests(schemaError);
            reject(schemaError);
          }
        });
      });
    } catch (error) {
      console.error('Failed to initialize SQLite database:', error);
      this.connectionState = 'disconnected';
      this._clearIdleTimer(); // Ensure timer is cleared on any initialization error
      this._rejectPendingRequests(error);
      throw error;
    }
  }

  /**
   * Create database schema if not exists
   * @returns {Promise<void>}
   */
  async createSchema() {
    const schema = `
      -- Main tasks table
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT CHECK (status IN ('pending', 'in-progress', 'done')) DEFAULT 'pending',
        priority TEXT CHECK (priority IN ('high', 'medium', 'low')) DEFAULT 'medium',
        notes TEXT,
        details TEXT DEFAULT '',
        parent_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES tasks(id)
      );

      -- Task dependencies
      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL,
        dependency_id TEXT NOT NULL,
        PRIMARY KEY (task_id, dependency_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (dependency_id) REFERENCES tasks(id)
      );

      -- Session management for SessionOrchestrator persistence
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        working_directory TEXT NOT NULL,
        status TEXT CHECK (status IN ('initializing', 'active', 'idle', 'busy', 'error', 'terminated', 'unhealthy')) DEFAULT 'initializing',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        terminated_at DATETIME,
        user_config TEXT, -- JSON serialized config
        message_count INTEGER DEFAULT 0,
        total_processing_time INTEGER DEFAULT 0, -- milliseconds
        error_count INTEGER DEFAULT 0,
        metadata TEXT -- JSON serialized metadata
      );

      -- Message queue persistence for session isolation
      CREATE TABLE IF NOT EXISTS session_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'error')) DEFAULT 'pending',
        sequence INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        processing_started_at DATETIME,
        completed_at DATETIME,
        processing_time_ms INTEGER,
        error_message TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      -- Performance indexes for tasks
      CREATE INDEX IF NOT EXISTS idx_task_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_task_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_task_parent ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_task_updated ON tasks(updated_at);

      -- Performance indexes for sessions
      CREATE INDEX IF NOT EXISTS idx_session_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_session_last_activity ON sessions(last_activity);
      CREATE INDEX IF NOT EXISTS idx_session_working_dir ON sessions(working_directory);

      -- Performance indexes for session messages
      CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON session_messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_messages_status ON session_messages(status);
      CREATE INDEX IF NOT EXISTS idx_session_messages_sequence ON session_messages(session_id, sequence);
    `;

    return new Promise((resolve, reject) => {
      this.db.exec(schema, (err) => {
        if (err) {
          console.error('Failed to create database schema:', err);
          reject(err);
        } else {
          console.log('✅ Database schema created successfully');
          resolve();
        }
      });
    });
  }

  /**
   * Wait for current connection to be established
   * @private
   */
  async _waitForConnection() {
    return new Promise((resolve, reject) => {
      this.pendingRequests.push({ resolve, reject });
    });
  }

  /**
   * Resolve all pending requests
   * @private
   */
  _resolvePendingRequests() {
    const requests = this.pendingRequests.splice(0);
    requests.forEach(({ resolve }) => resolve(true));
  }

  /**
   * Reject all pending requests
   * @private
   */
  _rejectPendingRequests(error) {
    const requests = this.pendingRequests.splice(0);
    requests.forEach(({ reject }) => reject(error));
  }

  /**
   * Start idle timer for connection cleanup
   * @private
   */
  _startIdleTimer() {
    // Prevent race conditions in timer creation
    this._clearIdleTimer();
    
    // Only create timer if we're actually connected
    if (this.connectionState !== 'connected') {
      return;
    }
    
    this.connectionTimeout = setTimeout(() => {
      if (this.connectionState === 'connected' && 
          Date.now() - this.lastActivity > this.IDLE_TIMEOUT) {
        console.log('📁 Closing idle SQLite connection');
        this.closeDB().catch(console.error);
      }
    }, this.IDLE_TIMEOUT);
  }

  /**
   * Clear idle timer safely
   * @private
   */
  _clearIdleTimer() {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }

  /**
   * Ensure database connection is ready
   * @private
   */
  async _ensureConnection() {
    this.lastActivity = Date.now();
    
    if (this.connectionState === 'connected' && this.db) {
      return;
    }

    if (this.connectionState === 'connecting' || this.connectionState === 'switching') {
      return this._waitForConnection();
    }

    throw new Error('Database not initialized. Call initDB() first.');
  }

  /**
   * Execute SQL query with parameters
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} - Query result
   */
  async executeQuery(sql, params = []) {
    await this._ensureConnection();
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.all(sql, params, (err, rows) => {
        if (err) {
          console.error('SQL query failed:', err);
          console.error('Query:', sql);
          console.error('Params:', params);
          reject(err);
        } else {
          this.lastActivity = Date.now();
          resolve(rows);
        }
      });
    });
  }

  /**
   * Execute SQL statement (INSERT, UPDATE, DELETE)
   * @param {string} sql - SQL statement
   * @param {Array} params - Statement parameters
   * @returns {Promise<Object>} - Statement result with lastID and changes
   */
  async executeStatement(sql, params = []) {
    await this._ensureConnection();
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.run(sql, params, function(err) {
        if (err) {
          console.error('SQL statement failed:', err);
          console.error('Statement:', sql);
          console.error('Params:', params);
          reject(err);
        } else {
          resolve({
            lastID: this.lastID,
            changes: this.changes
          });
        }
      });
    });
  }

  /**
   * Execute operations within a database transaction
   * @param {Function} operations - Async function containing operations to execute
   * @returns {Promise<any>} - Result from operations
   * @private
   */
  async _executeInTransaction(operations) {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }

      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION', (err) => {
          if (err) {
            reject(new Error(`Failed to begin transaction: ${err.message}`));
            return;
          }

          // Execute the operations
          operations()
            .then((result) => {
              // Operations succeeded, commit transaction
              this.db.run('COMMIT', (err) => {
                if (err) {
                  reject(new Error(`Failed to commit transaction: ${err.message}`));
                } else {
                  resolve(result);
                }
              });
            })
            .catch((error) => {
              // Operations failed, rollback transaction
              this.db.run('ROLLBACK', (rollbackErr) => {
                if (rollbackErr) {
                  console.error('Failed to rollback transaction:', rollbackErr);
                  reject(new Error(`Transaction failed and rollback failed: ${error.message}`));
                } else {
                  reject(new Error(`Transaction rolled back: ${error.message}`));
                }
              });
            });
        });
      });
    });
  }

  /**
   * Get all tasks with their subtasks and dependencies (optimized with JOIN)
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of parent tasks to return
   * @param {number} options.offset - Number of parent tasks to skip
   * @returns {Promise<Object>} - Tasks in JSON format
   */
  async getAllTasks(options = {}) {
    try {
      const { limit, offset } = options;
      
      // Build optimized query with JOINs
      let tasksQuery = `
        SELECT 
          t.id, t.title, t.description, t.status, t.priority, 
          t.notes, t.details, t.parent_id, t.created_at, t.updated_at,
          GROUP_CONCAT(td.dependency_id) as dependencies
        FROM tasks t
        LEFT JOIN task_dependencies td ON t.id = td.task_id
        GROUP BY t.id, t.title, t.description, t.status, t.priority, 
                 t.notes, t.details, t.parent_id, t.created_at, t.updated_at
        ORDER BY t.created_at DESC
      `;

      // Add pagination for parent tasks only
      const params = [];
      if (limit) {
        tasksQuery += ` LIMIT ?`;
        params.push(limit);
        if (offset) {
          tasksQuery += ` OFFSET ?`;
          params.push(offset);
        }
      }

      const allTasks = await this.executeQuery(tasksQuery, params);

      // Process results and build hierarchy
      const parentTasks = [];
      const childTasks = [];
      
      allTasks.forEach(task => {
        // Parse dependencies
        const dependencies = task.dependencies 
          ? task.dependencies.split(',').filter(dep => dep) 
          : [];
        
        const processedTask = {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dependencies: dependencies,
          notes: task.notes || '',
          details: task.details || '',
          createdAt: task.created_at,
          updatedAt: task.updated_at
        };

        if (task.parent_id) {
          processedTask.parent_id = task.parent_id;
          childTasks.push(processedTask);
        } else {
          parentTasks.push(processedTask);
        }
      });

      // Build task hierarchy efficiently
      const taskMap = new Map();
      
      // Initialize parent tasks with empty subtasks arrays
      const tasks = parentTasks.map(task => {
        const taskWithSubtasks = { ...task, subtasks: [] };
        taskMap.set(task.id, taskWithSubtasks);
        return taskWithSubtasks;
      });

      // Add subtasks to their parents
      childTasks.forEach(subtask => {
        const parent = taskMap.get(subtask.parent_id);
        if (parent) {
          const { parent_id, ...subtaskWithoutParentId } = subtask;
          parent.subtasks.push(subtaskWithoutParentId);
        }
      });

      return { tasks };
    } catch (error) {
      console.error('Failed to get all tasks:', error);
      throw error;
    }
  }

  /**
   * Get task count for pagination
   * @returns {Promise<number>} - Total number of parent tasks
   */
  async getTaskCount() {
    try {
      const result = await this.executeQuery(
        'SELECT COUNT(*) as count FROM tasks WHERE parent_id IS NULL'
      );
      return result[0].count;
    } catch (error) {
      console.error('Failed to get task count:', error);
      throw error;
    }
  }

  /**
   * Delete task by ID (handles subtasks and dependencies with transaction)
   * @param {string} taskId - Task ID to delete
   * @returns {Promise<Object>} - Deletion result
   */
  async deleteTask(taskId) {
    // Input validation
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      throw new Error('Task ID must be a non-empty string');
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // First check if task exists
      const task = await this.executeQuery(
        'SELECT id, title, parent_id FROM tasks WHERE id = ?', 
        [taskId]
      );

      if (task.length === 0) {
        throw new Error(`Task with ID '${taskId}' not found`);
      }

      const taskInfo = task[0];

      // Execute transaction using Promise-based approach
      return await this._executeInTransaction(async () => {
        // Delete task dependencies
        await this.executeStatement(
          'DELETE FROM task_dependencies WHERE task_id = ? OR dependency_id = ?',
          [taskId, taskId]
        );

        // If parent task, delete subtask dependencies and subtasks
        if (!taskInfo.parent_id) {
          await this.executeStatement(
            'DELETE FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE parent_id = ?)',
            [taskId]
          );
          await this.executeStatement('DELETE FROM tasks WHERE parent_id = ?', [taskId]);
        }

        // Finally delete the task itself
        const result = await this.executeStatement('DELETE FROM tasks WHERE id = ?', [taskId]);
        
        console.log(`✅ Successfully deleted task: ${taskInfo.title} (ID: ${taskId})`);
        return {
          deletedTask: {
            id: taskInfo.id,
            title: taskInfo.title
          },
          affectedRows: result.changes
        };
      });
    } catch (error) {
      console.error('❌ Failed to delete task:', error);
      throw error;
    }
  }

  /**
   * Delete subtask by parent task ID and subtask ID (with transaction)
   * @param {string} parentTaskId - Parent task ID
   * @param {string} subtaskId - Subtask ID to delete
   * @returns {Promise<Object>} - Deletion result
   */
  async deleteSubtask(parentTaskId, subtaskId) {
    // Input validation
    if (!parentTaskId?.trim() || !subtaskId?.trim()) {
      throw new Error('Both parentTaskId and subtaskId are required');
    }
    
    if (typeof parentTaskId !== 'string' || typeof subtaskId !== 'string') {
      throw new Error('Task IDs must be strings');
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Check if parent task exists
      const parentTask = await this.executeQuery(
        'SELECT id FROM tasks WHERE id = ? AND parent_id IS NULL',
        [parentTaskId]
      );

      if (parentTask.length === 0) {
        throw new Error(`Parent task with ID '${parentTaskId}' not found`);
      }

      // Check if subtask exists and belongs to parent
      const subtask = await this.executeQuery(
        'SELECT id, title FROM tasks WHERE id = ? AND parent_id = ?',
        [subtaskId, parentTaskId]
      );

      if (subtask.length === 0) {
        throw new Error(`Subtask with ID '${subtaskId}' not found in task '${parentTaskId}'`);
      }

      const subtaskInfo = subtask[0];

      // Execute transaction using Promise-based approach
      return await this._executeInTransaction(async () => {
        // Delete subtask dependencies first
        await this.executeStatement(
          'DELETE FROM task_dependencies WHERE task_id = ? OR dependency_id = ?',
          [subtaskId, subtaskId]
        );

        // Delete the subtask itself
        const result = await this.executeStatement('DELETE FROM tasks WHERE id = ?', [subtaskId]);
        
        console.log(`✅ Successfully deleted subtask: ${subtaskInfo.title} (ID: ${subtaskId}) from task ${parentTaskId}`);
        return {
          deletedSubtask: {
            id: subtaskInfo.id,
            title: subtaskInfo.title,
            parentTaskId: parentTaskId
          },
          affectedRows: result.changes
        };
      });
    } catch (error) {
      console.error('❌ Failed to delete subtask:', error);
      throw error;
    }
  }


  /**
   * Get count of subtasks for a specific parent task
   * @param {string} parentTaskId - Parent task ID
   * @returns {Promise<number>} - Count of subtasks
   */
  async getSubtaskCount(parentTaskId) {
    if (!parentTaskId || typeof parentTaskId !== 'string') {
      throw new Error('Parent task ID is required and must be a string');
    }

    try {
      const result = await this.executeQuery(
        'SELECT COUNT(*) as count FROM tasks WHERE parent_id = ?',
        [parentTaskId]
      );
      return result[0].count;
    } catch (error) {
      console.error('Failed to get subtask count:', error);
      throw error;
    }
  }

  /**
   * Check if database file exists
   * @param {string} projectHomePath - Project home path
   * @returns {boolean} - Whether database exists
   */
  static databaseExists(projectHomePath) {
    const dbPath = path.join(projectHomePath, 'docs', 'tasks.db');
    return fs.existsSync(dbPath);
  }

  /**
   * Atomically switch database connection to new project path
   * @param {string} newProjectHomePath - New project home path
   * @returns {Promise<boolean>} - Success status
   */
  async switchDatabase(newProjectHomePath) {
    const newDbPath = path.join(newProjectHomePath, 'docs', 'tasks.db');
    
    // If already connected to the same path, no need to switch
    if (this.connectionState === 'connected' && this.dbPath === newDbPath) {
      console.log('📁 Already connected to target database path');
      return true;
    }

    this.connectionState = 'switching';
    const oldDb = this.db;
    const oldDbPath = this.dbPath;
    
    try {
      // Check if target docs directory exists
      const docsDir = path.dirname(newDbPath);
      if (!fs.existsSync(docsDir)) {
        throw new Error(`Target project docs directory does not exist: ${docsDir}. Please create it manually or initialize with tasks first.`);
      }

      // Check if database exists
      if (!fs.existsSync(newDbPath)) {
        throw new Error(`Database not found in target project: ${newDbPath}. Please create tasks first or initialize the database manually.`);
      }

      // Create new connection to existing database
      const newDb = await new Promise((resolve, reject) => {
        const db = new sqlite3.Database(newDbPath, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(db);
          }
        });
      });

      // Atomic switch: update references
      this.db = newDb;
      this.dbPath = newDbPath;
      this.connectionState = 'connected';
      this.lastActivity = Date.now();
      this._startIdleTimer();

      // Close old connection (if exists)
      if (oldDb) {
        await new Promise((resolve) => {
          oldDb.close((err) => {
            if (err) {
              console.warn('Warning: Failed to close old database connection:', err);
            } else {
              console.log('📁 Old SQLite connection closed');
            }
            resolve();
          });
        });
      }

      console.log(`✅ Successfully switched SQLite database: ${oldDbPath} → ${newDbPath}`);
      this._resolvePendingRequests();
      return true;

    } catch (error) {
      console.error('❌ Failed to switch database:', error);
      
      // Restore previous connection state
      this.db = oldDb;
      this.dbPath = oldDbPath;
      this.connectionState = oldDb ? 'connected' : 'disconnected';
      
      this._rejectPendingRequests(error);
      throw error;
    }
  }

  /**
   * Close database connection
   * @returns {Promise<void>}
   */
  async closeDB() {
    // Clear idle timer using centralized method
    this._clearIdleTimer();

    return new Promise((resolve, reject) => {
      if (this.db) {
        this.connectionState = 'disconnected';
        this.db.close((err) => {
          if (err) {
            console.error('Failed to close database:', err);
            reject(err);
          } else {
            console.log('📁 SQLite database connection closed');
            this.db = null;
            this.dbPath = null;
            this.lastActivity = null;
            resolve();
          }
        });
      } else {
        this.connectionState = 'disconnected';
        this.db = null;
        this.dbPath = null;
        this.lastActivity = null;
        resolve();
      }
    });
  }

  /**
   * Get database connection (for advanced queries)
   * @returns {sqlite3.Database|null} - Database connection
   */
  getDB() {
    return this.db;
  }

  /**
   * Get current database path
   * @returns {string|null} - Database file path
   */
  getDBPath() {
    return this.dbPath;
  }

  // ===== SESSION PERSISTENCE METHODS =====

  /**
   * Create new session record in database
   * @param {Object} sessionData - Session data
   * @returns {Promise<Object>} - Created session result
   */
  async createSession(sessionData) {
    const {
      id,
      workingDirectory,
      status = 'initializing',
      userConfig = {},
      metadata = {}
    } = sessionData;

    if (!id || !workingDirectory) {
      throw new Error('Session ID and working directory are required');
    }

    try {
      const result = await this.executeStatement(`
        INSERT INTO sessions (
          id, working_directory, status, user_config, metadata
        ) VALUES (?, ?, ?, ?, ?)
      `, [
        id,
        workingDirectory,
        status,
        JSON.stringify(userConfig),
        JSON.stringify(metadata)
      ]);

      console.log(`✅ Session ${id} created in database`);
      return { sessionId: id, ...result };
    } catch (error) {
      console.error(`❌ Failed to create session ${id} in database:`, error);
      throw error;
    }
  }

  /**
   * Update session status and metadata
   * @param {string} sessionId - Session ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} - Update result
   */
  async updateSession(sessionId, updates) {
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    const allowedFields = [
      'status', 'last_activity', 'started_at', 'terminated_at',
      'message_count', 'total_processing_time', 'error_count', 'metadata'
    ];

    const setClauses = [];
    const params = [];

    Object.entries(updates).forEach(([field, value]) => {
      if (allowedFields.includes(field)) {
        setClauses.push(`${field} = ?`);
        if (field === 'metadata' && typeof value === 'object') {
          params.push(JSON.stringify(value));
        } else {
          params.push(value);
        }
      }
    });

    if (setClauses.length === 0) {
      throw new Error('No valid fields to update');
    }

    params.push(sessionId);

    try {
      const result = await this.executeStatement(`
        UPDATE sessions SET ${setClauses.join(', ')} WHERE id = ?
      `, params);

      if (result.changes === 0) {
        throw new Error(`Session ${sessionId} not found`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to update session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get session by ID
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object|null>} - Session data or null
   */
  async getSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    try {
      const sessions = await this.executeQuery(
        'SELECT * FROM sessions WHERE id = ?',
        [sessionId]
      );

      if (sessions.length === 0) {
        return null;
      }

      const session = sessions[0];
      return {
        ...session,
        userConfig: session.user_config ? JSON.parse(session.user_config) : {},
        metadata: session.metadata ? JSON.parse(session.metadata) : {}
      };
    } catch (error) {
      console.error(`❌ Failed to get session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Get all active sessions
   * @returns {Promise<Array>} - Array of active sessions
   */
  async getActiveSessions() {
    try {
      const sessions = await this.executeQuery(`
        SELECT * FROM sessions 
        WHERE status IN ('initializing', 'active', 'idle', 'busy') 
        ORDER BY last_activity DESC
      `);

      return sessions.map(session => ({
        ...session,
        userConfig: session.user_config ? JSON.parse(session.user_config) : {},
        metadata: session.metadata ? JSON.parse(session.metadata) : {}
      }));
    } catch (error) {
      console.error('❌ Failed to get active sessions:', error);
      throw error;
    }
  }

  /**
   * Delete session from database
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} - Delete result
   */
  async deleteSession(sessionId) {
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    try {
      return await this._executeInTransaction(async () => {
        // Delete session messages first (CASCADE should handle this, but being explicit)
        await this.executeStatement(
          'DELETE FROM session_messages WHERE session_id = ?',
          [sessionId]
        );

        // Delete session
        const result = await this.executeStatement(
          'DELETE FROM sessions WHERE id = ?',
          [sessionId]
        );

        if (result.changes === 0) {
          throw new Error(`Session ${sessionId} not found`);
        }

        console.log(`✅ Session ${sessionId} deleted from database`);
        return result;
      });
    } catch (error) {
      console.error(`❌ Failed to delete session ${sessionId}:`, error);
      throw error;
    }
  }

  // ===== SESSION MESSAGE PERSISTENCE METHODS =====

  /**
   * Save message to session queue
   * @param {Object} messageData - Message data
   * @returns {Promise<Object>} - Save result
   */
  async saveSessionMessage(messageData) {
    const {
      id,
      sessionId,
      message,
      status = 'pending',
      sequence
    } = messageData;

    if (!id || !sessionId || !message || sequence === undefined) {
      throw new Error('Message ID, session ID, message content, and sequence are required');
    }

    try {
      const result = await this.executeStatement(`
        INSERT INTO session_messages (
          id, session_id, message, status, sequence
        ) VALUES (?, ?, ?, ?, ?)
      `, [id, sessionId, message, status, sequence]);

      return { messageId: id, ...result };
    } catch (error) {
      console.error(`❌ Failed to save message ${id}:`, error);
      throw error;
    }
  }

  /**
   * Update message status and processing info
   * @param {string} messageId - Message ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} - Update result
   */
  async updateSessionMessage(messageId, updates) {
    if (!messageId) {
      throw new Error('Message ID is required');
    }

    const allowedFields = [
      'status', 'processing_started_at', 'completed_at', 
      'processing_time_ms', 'error_message'
    ];

    const setClauses = [];
    const params = [];

    Object.entries(updates).forEach(([field, value]) => {
      if (allowedFields.includes(field)) {
        setClauses.push(`${field} = ?`);
        params.push(value);
      }
    });

    if (setClauses.length === 0) {
      throw new Error('No valid fields to update');
    }

    params.push(messageId);

    try {
      const result = await this.executeStatement(`
        UPDATE session_messages SET ${setClauses.join(', ')} WHERE id = ?
      `, params);

      if (result.changes === 0) {
        throw new Error(`Message ${messageId} not found`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to update message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Get messages for a session
   * @param {string} sessionId - Session ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} - Array of messages
   */
  async getSessionMessages(sessionId, options = {}) {
    if (!sessionId) {
      throw new Error('Session ID is required');
    }

    const { status, limit, offset } = options;
    let query = 'SELECT * FROM session_messages WHERE session_id = ?';
    const params = [sessionId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY sequence ASC';

    if (limit) {
      query += ' LIMIT ?';
      params.push(limit);
      if (offset) {
        query += ' OFFSET ?';
        params.push(offset);
      }
    }

    try {
      return await this.executeQuery(query, params);
    } catch (error) {
      console.error(`❌ Failed to get messages for session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Delete message from session queue
   * @param {string} messageId - Message ID
   * @returns {Promise<Object>} - Delete result
   */
  async deleteSessionMessage(messageId) {
    if (!messageId) {
      throw new Error('Message ID is required');
    }

    try {
      const result = await this.executeStatement(
        'DELETE FROM session_messages WHERE id = ?',
        [messageId]
      );

      if (result.changes === 0) {
        throw new Error(`Message ${messageId} not found`);
      }

      return result;
    } catch (error) {
      console.error(`❌ Failed to delete message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Get session statistics
   * @param {string} sessionId - Session ID (optional, for all sessions if not provided)
   * @returns {Promise<Object>} - Session statistics
   */
  async getSessionStats(sessionId = null) {
    try {
      let query, params;

      if (sessionId) {
        // Stats for specific session
        query = `
          SELECT 
            s.id,
            s.working_directory,
            s.status,
            s.message_count,
            s.total_processing_time,
            s.error_count,
            COUNT(sm.id) as queued_messages,
            SUM(CASE WHEN sm.status = 'pending' THEN 1 ELSE 0 END) as pending_messages,
            SUM(CASE WHEN sm.status = 'processing' THEN 1 ELSE 0 END) as processing_messages,
            SUM(CASE WHEN sm.status = 'completed' THEN 1 ELSE 0 END) as completed_messages,
            SUM(CASE WHEN sm.status = 'error' THEN 1 ELSE 0 END) as error_messages
          FROM sessions s
          LEFT JOIN session_messages sm ON s.id = sm.session_id
          WHERE s.id = ?
          GROUP BY s.id
        `;
        params = [sessionId];
      } else {
        // Overall stats
        query = `
          SELECT 
            COUNT(DISTINCT s.id) as total_sessions,
            SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END) as active_sessions,
            SUM(CASE WHEN s.status = 'idle' THEN 1 ELSE 0 END) as idle_sessions,
            SUM(CASE WHEN s.status = 'error' THEN 1 ELSE 0 END) as error_sessions,
            SUM(s.message_count) as total_messages_processed,
            SUM(s.total_processing_time) as total_processing_time,
            COUNT(sm.id) as total_queued_messages,
            SUM(CASE WHEN sm.status = 'pending' THEN 1 ELSE 0 END) as pending_messages
          FROM sessions s
          LEFT JOIN session_messages sm ON s.id = sm.session_id
        `;
        params = [];
      }

      const result = await this.executeQuery(query, params);
      return sessionId ? result[0] : result[0];
    } catch (error) {
      console.error('❌ Failed to get session stats:', error);
      throw error;
    }
  }

  /**
   * Perform health check on sessions
   * @returns {Promise<Object>} - Health check result
   */
  async performHealthCheck() {
    try {
      const unhealthySessions = await this.executeQuery(`
        SELECT id, working_directory, error_count FROM sessions 
        WHERE status = 'active' 
        AND last_activity < datetime('now', '-1 hour')
      `);
      
      let updatedCount = 0;
      for (const session of unhealthySessions) {
        await this.updateSession(session.id, { 
          status: 'unhealthy',
          error_count: (session.error_count || 0) + 1 
        });
        updatedCount++;
      }
      
      console.log(`🏥 Health check completed: ${updatedCount} sessions marked as unhealthy`);
      return { 
        checkedSessions: unhealthySessions.length,
        updatedSessions: updatedCount 
      };
    } catch (error) {
      console.error('❌ Health check failed:', error);
      throw error;
    }
  }

  // ===== UTILITY METHODS =====

  /**
   * Safely parse JSON string with security validation
   * @param {string} jsonString - JSON string to parse
   * @param {any} defaultValue - Default value if parsing fails
   * @returns {any} - Parsed object or default value
   * @private
   */
  _safeJSONParse(jsonString, defaultValue = {}) {
    if (!jsonString || typeof jsonString !== 'string') {
      return defaultValue;
    }
    
    // Security: Limit JSON string size to prevent DoS attacks
    if (jsonString.length > DB_CONFIG.MAX_JSON_SIZE) {
      console.warn(`⚠️ JSON string too large (${jsonString.length} bytes), max allowed: ${DB_CONFIG.MAX_JSON_SIZE}`);
      return defaultValue;
    }
    
    // Security: Basic content validation
    if (jsonString.includes('__proto__') || jsonString.includes('constructor.prototype')) {
      console.warn('⚠️ JSON string contains potentially dangerous prototype pollution patterns');
      return defaultValue;
    }
    
    try {
      const parsed = JSON.parse(jsonString);
      
      // Security: Prevent prototype pollution
      if (parsed && typeof parsed === 'object' && ('__proto__' in parsed || 'constructor' in parsed)) {
        console.warn('⚠️ JSON contains prototype pollution attempt, sanitizing...');
        delete parsed.__proto__;
        delete parsed.constructor;
      }
      
      return parsed;
    } catch (error) {
      console.error('⚠️ JSON parsing failed:', error.message);
      return defaultValue;
    }
  }

  /**
   * Safely stringify object with fallback
   * @param {any} obj - Object to stringify
   * @param {string} defaultValue - Default value if stringification fails
   * @returns {string} - JSON string or default value
   * @private
   */
  _safeJSONStringify(obj, defaultValue = '{}') {
    if (obj === null || obj === undefined) {
      return defaultValue;
    }
    
    try {
      return JSON.stringify(obj);
    } catch (error) {
      console.error('⚠️ JSON stringification failed:', error.message);
      return defaultValue;
    }
  }
}

// Export singleton instance
const sqliteManager = new SQLiteManager();
export default sqliteManager;