import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import chokidar from 'chokidar';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

class SQLiteManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
    this.connectionState = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'switching'
    this.pendingRequests = [];
    this.connectionTimeout = null;
    this.lastActivity = null;
    this.IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes idle timeout
    this.fileWatcher = null;
    this.lastFileStats = null;
    this.isFileChanged = false;
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
   * Setup file system watcher for database file
   * @private
   */
  _setupFileWatcher() {
    // Close existing watcher
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }

    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      return;
    }

    console.log(`📁 Setting up file watcher for: ${this.dbPath}`);
    
    this.fileWatcher = chokidar.watch(this.dbPath, {
      ignoreInitial: true,
      persistent: true,
      usePolling: false, // Use native file system events
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms for write to stabilize
        pollInterval: 50
      }
    });

    this.fileWatcher.on('change', () => {
      console.log('📁 Database file changed, marking for reconnect');
      this.isFileChanged = true;
      this.lastFileStats = null; // Reset stats to force recheck
    });

    this.fileWatcher.on('unlink', () => {
      console.log('📁 Database file deleted');
      this.connectionState = 'disconnected';
      this.isFileChanged = true;
    });

    this.fileWatcher.on('add', () => {
      console.log('📁 Database file created/restored');
      this.isFileChanged = true;
      this.lastFileStats = null;
    });

    this.fileWatcher.on('error', (error) => {
      console.error('📁 File watcher error:', error);
      // Don't change connection state on watcher errors
    });
  }

  /**
   * Check if connection is healthy by running a simple query
   * @private
   * @returns {Promise<boolean>}
   */
  async _isConnectionHealthy() {
    if (!this.db || this.connectionState !== 'connected') {
      return false;
    }

    try {
      await new Promise((resolve, reject) => {
        this.db.get('SELECT 1 as test', (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        });
      });
      return true;
    } catch (error) {
      console.log('📁 Connection health check failed:', error.message);
      return false;
    }
  }

  /**
   * Check if database file has changed based on stats
   * @private
   * @returns {boolean}
   */
  _hasFileChanged() {
    if (this.isFileChanged) {
      this.isFileChanged = false; // Reset flag
      return true;
    }

    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      return true;
    }

    try {
      const currentStats = fs.statSync(this.dbPath);
      
      if (!this.lastFileStats) {
        this.lastFileStats = {
          mtime: currentStats.mtime.getTime(),
          size: currentStats.size,
          ino: currentStats.ino
        };
        return false;
      }

      const changed = 
        this.lastFileStats.mtime !== currentStats.mtime.getTime() ||
        this.lastFileStats.size !== currentStats.size ||
        this.lastFileStats.ino !== currentStats.ino;

      if (changed) {
        console.log('📁 Database file stats changed');
        this.lastFileStats = {
          mtime: currentStats.mtime.getTime(),
          size: currentStats.size,
          ino: currentStats.ino
        };
        return true;
      }

      return false;
    } catch (error) {
      console.warn('📁 Error checking file stats:', error);
      return true; // Assume changed if we can't check
    }
  }

  /**
   * Initialize SQLite database connection with state management
   * @param {string} projectHomePath - Path to project home directory
   * @param {boolean} isSwitch - Whether this is a project switch
   * @returns {Promise<boolean>} - Success status
   */
  async initDB(projectHomePath, isSwitch = false) {
    // If we're already connecting to the same path, wait for it
    if (this.connectionState === 'connecting' && this.dbPath === path.join(projectHomePath, 'docs', 'tasks.db')) {
      return this._waitForConnection();
    }

    // If we're switching, set state appropriately
    if (isSwitch) {
      this.connectionState = 'switching';
    } else {
      this.connectionState = 'connecting';
    }

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
            this._setupFileWatcher(); // Setup file watcher
            this._resolvePendingRequests();
            resolve(true);
          } catch (schemaError) {
            this.connectionState = 'disconnected';
            this._rejectPendingRequests(schemaError);
            reject(schemaError);
          }
        });
      });
    } catch (error) {
      console.error('Failed to initialize SQLite database:', error);
      this.connectionState = 'disconnected';
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

      -- Performance indexes
      CREATE INDEX IF NOT EXISTS idx_task_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_task_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_task_parent ON tasks(parent_id);
      CREATE INDEX IF NOT EXISTS idx_task_updated ON tasks(updated_at);
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
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
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
   * @param {boolean} forceReconnect - Force reconnection even if path is the same
   * @returns {Promise<boolean>} - Success status
   */
  async switchDatabase(newProjectHomePath, forceReconnect = false) {
    const newDbPath = path.join(newProjectHomePath, 'docs', 'tasks.db');
    
    // Determine if reconnection is needed
    let needsReconnect = forceReconnect;
    
    if (!needsReconnect && this.connectionState === 'connected' && this.dbPath === newDbPath) {
      // For the same database path, check if file changed or connection is unhealthy
      const fileChanged = this._hasFileChanged();
      const connectionHealthy = await this._isConnectionHealthy();
      
      if (!connectionHealthy) {
        console.log('📁 Connection health check failed, reconnection needed');
        needsReconnect = true;
      } else if (fileChanged) {
        console.log('📁 Database file changed, reconnection needed');
        needsReconnect = true;
      }
    } else if (this.dbPath !== newDbPath) {
      // Different database path, always reconnect
      needsReconnect = true;
    }
    
    if (this.connectionState === 'connected' && this.dbPath === newDbPath && !needsReconnect) {
      // Connection is healthy and file hasn't changed
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
      this._setupFileWatcher(); // Setup file watcher for new database

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
    // Clear idle timer
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }

    // Close file watcher
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }

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
}

// Export singleton instance
const sqliteManager = new SQLiteManager();
export default sqliteManager;