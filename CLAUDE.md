# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an AI-powered task management desktop application built with React, TypeScript, Vite, and Electron. It provides real-time task tracking, progress monitoring, and cross-platform compatibility. The application is designed to work seamlessly with AI development assistants by providing structured task management through JSON data and specialized Cursor rules.

## Technology Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS
- **Build Tool**: Vite 6.x  
- **Desktop Framework**: Electron 36.x
- **UI Components**: Shadcn/UI (New York style), Radix UI primitives, Lucide React icons
- **Data Export**: XLSX library for Excel export
- **State Management**: React hooks (no external state management library)

## Common Development Commands

```bash
# Install dependencies
npm install

# Development (web browser)
npm run dev

# Development (Electron app with hot reload)
npm run electron-dev

# Production build
npm run build

# Run Electron app from build
npm run electron

# Create distribution packages (macOS/Windows/Linux)
npm run dist

# Linting
npm run lint

# Preview built files
npm run preview
```

## Project Architecture

### Data Flow Architecture
- **Data Source**: `public/tasks.json` - Contains task hierarchy with status, dependencies, and metadata
- **Auto-refresh**: App polls tasks.json every 5 seconds for real-time updates
- **Dual Environment**: Works in both web browser and Electron desktop app
- **Cross-platform**: Supports macOS, Windows, Linux through Electron builder

### Key Components Structure
- `App.tsx` - Main app with environment detection (Electron vs web), data fetching, keyboard shortcuts
- `Dashboard.tsx` - Main layout coordinator between stats header and task table
- `TaskTable.tsx` - Hierarchical task display with collapsible subtasks
- `StatsHeader.tsx` - Animated progress counters and export functionality
- `TaskDetailsModal.tsx` - Modal for viewing detailed task information

### Type System
- `types/task.ts` - Comprehensive type definitions for Task, SubTask, and TaskStats interfaces
- Tasks support hierarchical structure with unlimited nesting through subtasks array
- Status values: `'pending' | 'partial' | 'done'`
- Priority levels: `'low' | 'medium' | 'high'`

### Electron Integration
- `electron/main.cjs` - Main process with window management and IPC
- `electron/preload.cjs` - Secure IPC bridge with file system access
- Platform-specific features: keyboard shortcuts (Ctrl/Cmd+M minimize, F11 fullscreen)
- Development mode indicators and error handling

## Component Guidelines

### Shadcn/UI Configuration
- Uses "new-york" style variant with slate base color
- CSS variables enabled for theming
- Components located in `src/components/ui/`
- Custom path aliases configured: `@/components/*` and `@/lib/*`

### Adding New Components
```bash
# Add Shadcn/UI components
npx shadcn@latest add [component-name]
```

### Styling Conventions
- Dark theme by default (`className="dark"`)
- Tailwind CSS for all styling
- Responsive design with mobile-first approach
- Consistent color scheme using CSS variables from Shadcn/UI

## Data Format

### tasks.json Structure
```json
{
  "tasks": [
    {
      "id": "string",
      "title": "string", 
      "description": "string",
      "status": "pending|partial|done",
      "notes": "string",
      "dependencies": ["task_id_array"],
      "priority": "low|medium|high",
      "details": "markdown_string",
      "testStrategy": "string",
      "subtasks": [/* nested task objects */],
      "createdAt": "ISO_8601_timestamp",
      "updatedAt": "ISO_8601_timestamp"
    }
  ]
}
```

## AI Development Integration

### Cursor Rules (.cursor/rules/)
This project includes sophisticated AI assistant rules:

1. **prd.mdc** - Product Requirements Document generator
   - Transforms vague ideas into structured PRDs through guided questioning
   - Acts as product manager asking strategic questions
   - Output: Comprehensive markdown PRD (2,000-4,000 words)

2. **task-breakdown.mdc** - Development plan generator  
   - Converts PRDs into detailed task lists
   - Creates hierarchical tasks with dependencies, priorities, implementation details
   - Output: Structured JSON matching tasks.json schema

3. **task-updater.mdc** - Progress tracking assistant
   - Updates task status based on user progress reports
   - Handles status cascading (subtask completion → parent status updates)
   - Output: JSON update blocks for tasks.json

### Usage Patterns
- Use task breakdown rules when planning new features from PRDs
- Use task updater rules when reporting progress on existing tasks
- The dashboard auto-refreshes to show updated task status
- Export functionality available for project reporting

## Development Best Practices

### File Organization
- Components follow single responsibility principle
- Hooks directory for reusable logic (`useTaskStats.ts`)
- Utility functions in `lib/utils.ts`
- Type definitions centralized in `types/`

### Error Handling
- Graceful degradation between Electron and web environments
- User-friendly error messages with retry mechanisms
- Background error notifications (bottom-right corner)

### Performance Considerations
- Auto-refresh with 5-second intervals (configurable)
- Efficient re-renders using React keys and proper dependency arrays
- Lazy loading and code splitting opportunities available

## Build and Distribution

### Development Build Process
1. TypeScript compilation (`tsc -b`)
2. Vite build process
3. Asset optimization and bundling

### Electron Distribution
- Cross-platform packaging via electron-builder
- Platform-specific icons and metadata
- Output directory: `release-builds/`
- NSIS installer for Windows, DMG for macOS, AppImage for Linux

## Testing Strategy

Currently no formal testing framework is configured. When adding tests, consider:
- Unit tests for utility functions and hooks
- Component testing for UI interactions  
- Integration tests for Electron IPC communication
- E2E tests for task management workflows