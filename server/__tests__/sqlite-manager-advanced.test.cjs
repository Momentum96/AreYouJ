const fs = require('fs');
const path = require('path');
const os = require('os');
const { fileURLToPath } = require('url');

// Import SQLiteManager singleton - use dynamic import since it's ES module
let sqliteManager;

// Simple test runner
const tests = [];
const results = {
  passed: 0,
  failed: 0,
  total: 0
};

function test(name, fn) {
  tests.push({ name, fn });
}

function expect(actual) {
  return {
    toBe: (expected) => {
      if (actual !== expected) {
        throw new Error(`Expected ${expected}, got ${actual}`);
      }
    },
    toEqual: (expected) => {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toThrow: async (expected) => {
      let threw = false;
      try {
        if (typeof actual === 'function') {
          await actual();
        }
      } catch (e) {
        threw = true;
        if (expected && !e.message.includes(expected)) {
          throw new Error(`Expected error containing "${expected}", got "${e.message}"`);
        }
      }
      if (!threw) {
        throw new Error('Expected function to throw');
      }
    },
    toBeTruthy: () => {
      if (!actual) {
        throw new Error(`Expected ${actual} to be truthy`);
      }
    },
    toBeFalsy: () => {
      if (actual) {
        throw new Error(`Expected ${actual} to be falsy`);
      }
    }
  };
}

// Helper function to create temporary database with proper structure
function createTempProject() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'areuyouj-filewatch-test-'));
  const docsDir = path.join(projectDir, 'docs');
  const dbPath = path.join(docsDir, 'tasks.db');
  
  // Create docs directory
  fs.mkdirSync(docsDir, { recursive: true });
  
  // Create empty database file
  fs.writeFileSync(dbPath, '');
  
  return { projectDir, docsDir, dbPath };
}

// Helper function to wait
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 Running Advanced SQLite Manager Tests...\n');
  
  // Load SQLiteManager singleton dynamically
  try {
    const module = await import('../db/sqlite.js');
    sqliteManager = module.default;
  } catch (error) {
    console.error('Failed to import SQLiteManager:', error);
    process.exit(1);
  }

  for (const { name, fn } of tests) {
    results.total++;
    try {
      await fn();
      console.log(`✅ ${name}`);
      results.passed++;
    } catch (error) {
      console.log(`❌ ${name}`);
      console.log(`   Error: ${error.message}`);
      results.failed++;
    }
  }
  
  console.log(`\n📊 Advanced Test Results:`);
  console.log(`   Total: ${results.total}`);
  console.log(`   Passed: ${results.passed}`);
  console.log(`   Failed: ${results.failed}`);
  console.log(`   Success Rate: ${Math.round((results.passed / results.total) * 100)}%`);
  
  process.exit(results.failed > 0 ? 1 : 0);
}

// File watching tests
test('File watcher initializes correctly', async () => {
  const { projectDir } = createTempProject();
  
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    await sqliteManager.initDB(projectDir);
    
    // Check that file watcher is set up
    expect(sqliteManager.fileWatcher).toBeTruthy();
    
    await sqliteManager.closeDB();
    
    // Check that file watcher is cleaned up
    expect(sqliteManager.fileWatcher).toBeFalsy();
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('File watcher detects file changes with debouncing', async () => {
  const { projectDir, dbPath } = createTempProject();
  
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    await sqliteManager.initDB(projectDir);
    
    // Reset the file changed flag
    sqliteManager.isFileChanged = false;
    
    // Simulate rapid file changes
    fs.writeFileSync(dbPath, 'change1');
    fs.writeFileSync(dbPath, 'change2');
    fs.writeFileSync(dbPath, 'change3');
    
    // Should not be changed immediately due to debouncing
    expect(sqliteManager.isFileChanged).toBe(false);
    
    // Wait for debounce to complete (need to wait longer than FILE_CHANGE_DEBOUNCE = 200ms)
    await delay(350);
    
    // Now should be marked as changed
    expect(sqliteManager.isFileChanged).toBe(true);
    
    await sqliteManager.closeDB();
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('File watcher handles file deletion', async () => {
  const { projectDir, dbPath } = createTempProject();
  
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    await sqliteManager.initDB(projectDir);
    
    // Delete the file
    fs.unlinkSync(dbPath);
    
    // Wait for file system event (longer delay for file deletion)
    await delay(500);
    
    // Connection state should be updated
    expect(sqliteManager.connectionState).toBe('disconnected');
    expect(sqliteManager.isFileChanged).toBe(true);
    
    await sqliteManager.closeDB();
  } finally {
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }
});

// Database switching tests
test('Database switching works correctly', async () => {
  const project1 = createTempProject();
  const project2 = createTempProject();
  
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    // Initialize with first database
    await sqliteManager.initDB(project1.projectDir);
    expect(sqliteManager.dbPath).toBe(project1.dbPath);
    
    // Switch to second database
    await sqliteManager.switchDatabase(project2.projectDir);
    expect(sqliteManager.dbPath).toBe(project2.dbPath);
    expect(sqliteManager.connectionState).toBe('connected');
    
    await sqliteManager.closeDB();
  } finally {
    fs.rmSync(project1.projectDir, { recursive: true, force: true });
    fs.rmSync(project2.projectDir, { recursive: true, force: true });
  }
});

// Error recovery tests
test('Database handles connection errors gracefully', async () => {
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    // Try to initialize with non-existent path
    await expect(async () => {
      await sqliteManager.initDB('/nonexistent/path/database.db');
    }).toThrow();
    
    expect(sqliteManager.connectionState).toBe('disconnected');
  } finally {
    await sqliteManager.closeDB();
  }
});

test('File watcher closes safely on errors', async () => {
  const { projectDir } = createTempProject();
  
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    await sqliteManager.initDB(projectDir);
    
    // Force close the watcher to simulate error conditions
    if (sqliteManager.fileWatcher) {
      sqliteManager.fileWatcher.close(); // Close it normally first
      sqliteManager.fileWatcher = {
        close: () => {
          throw new Error('Simulated watcher close error');
        }
      };
    }
    
    // closeDB should handle this gracefully
    await sqliteManager.closeDB();
    expect(sqliteManager.fileWatcher).toBeFalsy();
  } finally {
    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  }
});

// Resource cleanup tests
test('All timers are cleaned up on close', async () => {
  const { projectDir } = createTempProject();
  
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    await sqliteManager.initDB(projectDir);
    
    // Start idle timer
    sqliteManager._startIdleTimer();
    expect(sqliteManager.connectionTimeout).toBeTruthy();
    
    // Simulate file change to create debounce timer
    sqliteManager.isFileChanged = false;
    if (sqliteManager.fileWatcher) {
      sqliteManager.fileWatcher.emit('change');
    }
    
    // Wait a bit for debounce timer to be set
    await delay(50);
    expect(sqliteManager.fileChangeDebounceTimer).toBeTruthy();
    
    // Close should clean up all timers
    await sqliteManager.closeDB();
    expect(sqliteManager.connectionTimeout).toBeFalsy();
    expect(sqliteManager.fileChangeDebounceTimer).toBeFalsy();
    
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Connection health check works', async () => {
  const { projectDir } = createTempProject();
  
  try {
    // Ensure clean state
    await sqliteManager.closeDB();
    
    await sqliteManager.initDB(projectDir);
    
    // Healthy connection should pass
    const isHealthy = await sqliteManager._isConnectionHealthy();
    expect(isHealthy).toBe(true);
    
    // Close connection and check again
    await sqliteManager.closeDB();
    const isUnhealthy = await sqliteManager._isConnectionHealthy();
    expect(isUnhealthy).toBe(false);
    
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

runTests();