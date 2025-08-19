import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

class SQLiteManager {
  constructor() {
    this.db = null;
    this.dbPath = null;
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
   * Initialize SQLite database connection
   * @param {string} projectHomePath - Path to project home directory
   * @returns {Promise<boolean>} - Success status
   */
  async initDB(projectHomePath) {
    try {
      this.dbPath = path.join(projectHomePath, 'docs', 'tasks.db');
      
      // Ensure docs directory exists
      const docsDir = path.dirname(this.dbPath);
      if (!fs.existsSync(docsDir)) {
        fs.mkdirSync(docsDir, { recursive: true });
      }

      // Check if database file exists
      const dbExists = fs.existsSync(this.dbPath);
      
      return new Promise((resolve, reject) => {
        this.db = new sqlite3.Database(this.dbPath, (err) => {
          if (err) {
            console.error('Failed to open SQLite database:', err);
            reject(err);
            return;
          }
          
          console.log(`📁 SQLite database connected: ${this.dbPath}`);
          
          // If database is new, create schema
          if (!dbExists) {
            this.createSchema()
              .then(() => resolve(true))
              .catch(reject);
          } else {
            resolve(true);
          }
        });
      });
    } catch (error) {
      console.error('Failed to initialize SQLite database:', error);
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
   * Execute SQL query with parameters
   * @param {string} sql - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<Object>} - Query result
   */
  async executeQuery(sql, params = []) {
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
   * Get all tasks with their subtasks (JSON compatible format)
   * @returns {Promise<Object>} - Tasks in JSON format
   */
  async getAllTasks() {
    try {
      // Get all tasks
      const allTasks = await this.executeQuery(`
        SELECT id, title, description, status, priority, notes, details, 
               parent_id, created_at, updated_at
        FROM tasks
        ORDER BY id
      `);

      // Get all dependencies
      const dependencies = await this.executeQuery(`
        SELECT task_id, dependency_id 
        FROM task_dependencies
      `);

      // Group dependencies by task_id
      const dependencyMap = {};
      dependencies.forEach(dep => {
        if (!dependencyMap[dep.task_id]) {
          dependencyMap[dep.task_id] = [];
        }
        dependencyMap[dep.task_id].push(dep.dependency_id);
      });

      // Separate parent tasks and subtasks
      const parentTasks = allTasks.filter(task => !task.parent_id);
      const childTasks = allTasks.filter(task => task.parent_id);

      // Build task hierarchy (JSON compatible)
      const tasks = parentTasks.map(task => {
        const subtasks = childTasks
          .filter(child => child.parent_id === task.id)
          .map(subtask => ({
            id: subtask.id,
            title: subtask.title,
            description: subtask.description,
            status: subtask.status,
            priority: subtask.priority,
            dependencies: dependencyMap[subtask.id] || [],
            notes: subtask.notes || '',
            details: subtask.details || '',
            createdAt: subtask.created_at,
            updatedAt: subtask.updated_at
          }));

        return {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dependencies: dependencyMap[task.id] || [],
          notes: task.notes || '',
          details: task.details || '',
          createdAt: task.created_at,
          updatedAt: task.updated_at,
          subtasks: subtasks
        };
      });

      return { tasks };
    } catch (error) {
      console.error('Failed to get all tasks:', error);
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
   * Get count of parent tasks (tasks without parent_id)
   * @returns {Promise<number>} - Count of parent tasks
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
   * Close database connection
   * @returns {Promise<void>}
   */
  async closeDB() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            console.error('Failed to close database:', err);
            reject(err);
          } else {
            console.log('📁 SQLite database connection closed');
            this.db = null;
            this.dbPath = null;
            resolve();
          }
        });
      } else {
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