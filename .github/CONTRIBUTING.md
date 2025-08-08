# Contributing to AI Project Dashboard

Thank you for your interest in contributing to the AI Project Dashboard! 🎉

This document provides guidelines and information for contributors to help maintain code quality and ensure a smooth collaboration process.

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18.17.0 or higher)
- **npm** (v9.6.7 or higher)
- **Git**
- A modern web browser (Chrome, Firefox, Safari, or Edge)

### Setting Up the Development Environment

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/your-username/ai-project-dashboard.git
   cd ai-project-dashboard
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Start the development server**

   ```bash
   npm run dev:full
   ```

4. **Verify the setup**
   - Open http://localhost:5173 in your browser
   - You should see the AI Project Dashboard interface

## 📋 How to Contribute

### Reporting Bugs 🐛

1. **Search existing issues** first to avoid duplicates
2. **Use the Bug Report template** when creating a new issue
3. **Provide detailed information** including:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser and environment details
   - Console errors (if any)

### Requesting Features ✨

1. **Check existing feature requests** to see if it's already been suggested
2. **Use the Feature Request template** for new suggestions
3. **Clearly explain**:
   - The problem you're trying to solve
   - Your proposed solution
   - How it benefits users
   - Concrete use case examples

### Contributing Code 🔧

#### Before Starting Development

1. **Create an issue** for discussion (unless it's a minor fix)
2. **Wait for confirmation** from maintainers before starting work
3. **Check the project roadmap** to ensure alignment

#### Development Workflow

1. **Create a feature branch**

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

2. **Make your changes**

   - Follow our coding standards (see below)
   - Write clear, descriptive commit messages
   - Keep changes focused and atomic

3. **Test your changes**

   ```bash
   npm run lint    # Check code style
   npm run build   # Verify build works
   ```

4. **Commit your changes**

   ```bash
   git add .
   git commit -m "feat: add new feature description"
   ```

5. **Push and create a Pull Request**
   ```bash
   git push origin feature/your-feature-name
   ```
   - Use our Pull Request template
   - Provide clear description and testing instructions
   - Link related issues

## 🎨 Coding Standards

### General Principles

- **Write clear, readable code** with descriptive names
- **Follow existing patterns** in the codebase
- **Add comments** for complex logic
- **Keep functions small** and focused
- **Handle errors gracefully**

### TypeScript Guidelines

- **Use strict TypeScript** - avoid `any` types
- **Define proper interfaces** for data structures
- **Use type-only imports** where appropriate
- **Leverage union types** for better type safety

```typescript
// Good
interface Task {
  id: string;
  title: string;
  status: "pending" | "in-progress" | "completed";
}

// Avoid
interface Task {
  id: any;
  title: any;
  status: any;
}
```

### React Component Guidelines

- **Use functional components** with hooks
- **Implement proper cleanup** in useEffect
- **Extract constants** outside components to prevent re-renders
- **Use meaningful component names**
- **Handle loading and error states**

```typescript
// Good
const TASK_COLORS = {
  pending: "bg-gray-500/20",
  // ...
} as const;

const TaskCard: React.FC<TaskCardProps> = ({ task }) => {
  const [loading, setLoading] = useState(false);
  // ...
};
```

### CSS/Styling Guidelines

- **Use Tailwind CSS classes** consistently
- **Follow responsive-first approach**
- **Maintain consistent spacing** (using Tailwind's spacing scale)
- **Use semantic color names** from the design system

### File Organization

- **Components** in `src/components/`
- **Utilities** in `src/utils/`
- **Types** in `src/types/`
- **Hooks** in `src/hooks/`
- **Use descriptive file names**
- **Group related files together**

## 🧪 Testing Guidelines

### Manual Testing

Always test your changes:

1. **Happy path scenarios** - test main functionality works
2. **Error scenarios** - test error handling works correctly
3. **Edge cases** - test boundary conditions
4. **Cross-browser compatibility** - test in different browsers
5. **Responsive behavior** - test on different screen sizes

### Automated Testing

While we're working on expanding test coverage:

- **Add tests** for new utility functions
- **Test error boundary scenarios** where applicable
- **Include integration tests** for critical flows
- **Run existing tests** before submitting: `npm test` (when available)

## 🔒 Security Guidelines

- **Validate user inputs** to prevent XSS and injection attacks
- **Don't log sensitive information**
- **Use secure communication** (HTTPS/WSS in production)
- **Keep dependencies updated**
- **Follow authentication best practices**

## 📦 Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Commit Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc.)
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

### Examples

```bash
feat: add task priority filtering to dashboard
fix: resolve WebSocket connection timeout issue
docs: update README with new installation steps
refactor: extract common API error handling logic
```

## 🚦 Pull Request Process

### Before Submitting

- [ ] Code follows project coding standards
- [ ] All tests pass (`npm run lint`, `npm run build`)
- [ ] Changes are well documented
- [ ] Related issues are linked
- [ ] Screenshots/videos included for UI changes

### Review Process

1. **Automated checks** must pass (lint, build)
2. **Manual review** by maintainers
3. **Testing** by reviewers
4. **Claude Code Review** (automated)
5. **Approval** required before merge

### After Approval

- **Maintainers will merge** your PR
- **Thank you!** Your contribution helps make the project better

## 🤝 Community Guidelines

### Be Respectful

- **Use inclusive language**
- **Be constructive** in feedback
- **Help newcomers**
- **Give credit** where due

### Communication

- **GitHub Issues** for bug reports and feature requests
- **Pull Requests** for code contributions
- **Discussions** for questions and ideas
- **Clear and concise** communication

## 🆘 Getting Help

### Resources

- **Documentation**: Check the [README](../README.md)
- **Issues**: Browse [existing issues](https://github.com/Momentum96/ai-project-dashboard/issues)
- **Discussions**: Join [community discussions](https://github.com/Momentum96/ai-project-dashboard/discussions)
- **Claude Code Docs**: [Official Documentation](https://docs.anthropic.com/en/docs/claude-code)

### Questions?

- **Open a Discussion** for general questions
- **Create an Issue** for bugs or feature requests
- **Comment on existing Issues** for related discussions

## 🙏 Recognition

Contributors will be:

- **Listed in release notes** for their contributions
- **Mentioned in the README** (for significant contributions)
- **Invited to be collaborators** (for consistent contributors)

Thank you for contributing to the AI Project Dashboard! Your efforts help make AI-powered development tools accessible to more developers. 🚀

---

**Happy Coding!** 💻✨
