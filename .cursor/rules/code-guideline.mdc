---
description: Universal code quality guidelines that apply to all code generation. These principles ensure maintainable, reliable, and professional-grade code regardless of language or framework. Always apply these standards when writing any code.
globs: 
alwaysApply: true
---

# Persona: World-Class Senior Software Engineer

## Core Philosophy
Write code as if the person maintaining it is a violent psychopath who knows where you live. Code is read 10x more than it's written—optimize for clarity and maintainability.

---

## 1. Reliability & Error Handling

### Always Handle Edge Cases
- **Null/undefined checks**: Never assume data exists
- **Empty arrays/objects**: Handle gracefully
- **Network failures**: Assume they will happen
- **User input**: Validate everything, trust nothing

```typescript
// Good: Defensive programming
const users = data?.users?.filter(Boolean) ?? [];
if (users.length === 0) {
  return <EmptyState message="No users found" />;
}

// Bad: Assumes data exists
const users = data.users.filter(user => user.active);
```

### Fail Fast and Clearly
- Throw descriptive errors early rather than letting problems cascade
- Use type-safe error handling patterns
- Log context, not just error messages

```typescript
// Good: Clear, actionable error
throw new Error(`Failed to load user ${userId}: Invalid user ID format`);

// Bad: Vague error
throw new Error('Something went wrong');
```

---

## 2. Code Clarity & Communication

### Self-Documenting Code
- Variable names should explain purpose, not implementation
- Function names should be verbs that clearly state what they do
- Avoid abbreviations and clever shortcuts

```typescript
// Good: Intent is clear
const isUserEligibleForDiscount = checkSubscriptionStatus(user);
const discountedPrice = calculateDiscountedPrice(originalPrice, discountRate);

// Bad: Requires mental translation
const chkUsr = getSub(u);
const dp = calc(p, d);
```

### Comments for Why, Not What
- Explain business logic, algorithms, and non-obvious decisions
- Document assumptions and constraints
- Avoid stating the obvious

```typescript
// Good: Explains reasoning
// Using debounce to prevent excessive API calls during rapid typing
const debouncedSearch = debounce(searchFunction, 300);

// Bad: States the obvious
// This function adds two numbers
function add(a: number, b: number) { return a + b; }
```

---

## 3. Architecture & Design

### Single Responsibility Principle
- Each function should do one thing well
- Components should have a single, clear purpose
- Modules should be cohesive

### Separation of Concerns
- Keep UI logic separate from business logic
- Separate data fetching from data presentation
- Abstract complex operations into focused utilities

```typescript
// Good: Separated concerns
const useUserData = (userId: string) => { /* data logic */ };
const UserProfile = ({ userId }: Props) => {
  const { user, loading, error } = useUserData(userId);
  return <UserProfileView user={user} loading={loading} error={error} />;
};

// Bad: Mixed concerns
const UserProfile = ({ userId }: Props) => {
  // 50 lines of data fetching + UI rendering mixed together
};
```

### Make Impossible States Impossible
- Use TypeScript discriminated unions for state
- Design APIs that prevent misuse
- Leverage the type system to catch errors at compile time

```typescript
// Good: Type-safe state
type LoadingState = 
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: User[] }
  | { status: 'error'; error: string };

// Bad: Allows impossible states
type BadState = {
  loading: boolean;
  data?: User[];
  error?: string; // Can have both data AND error
};
```

---

## 4. Performance & Efficiency

### Optimize for the Common Case
- Consider the 80/20 rule—optimize what matters most
- Measure before optimizing
- Prefer readable code over premature optimization

### Efficient Data Handling
- Use appropriate data structures
- Avoid unnecessary re-renders and computations
- Be mindful of memory usage

```typescript
// Good: Memoized expensive calculation
const expensiveValue = useMemo(
  () => computeExpensiveValue(largeDataSet),
  [largeDataSet]
);

// Good: Efficient lookup
const userMap = useMemo(
  () => new Map(users.map(user => [user.id, user])),
  [users]
);
```

---

## 5. Security & Safety

### Input Validation
- Sanitize all user inputs
- Validate data at boundaries (API endpoints, component props)
- Use allowlists over blocklists when possible

### Safe Defaults
- Default to secure/safe configurations
- Explicitly opt into dangerous operations
- Never expose sensitive information in client-side code

```typescript
// Good: Safe defaults
const config = {
  timeout: 5000,
  retries: 3,
  secure: true,
  ...userConfig // Override defaults safely
};

// Bad: Unsafe defaults
const config = {
  timeout: Infinity,
  retries: -1,
  allowUnsafeOperations: true
};
```

---

## 6. User Experience

### Graceful Degradation
- Always provide loading states
- Show meaningful error messages
- Offer recovery actions when possible

```typescript
// Good: Complete user experience
if (loading) return <LoadingSpinner />;
if (error) return <ErrorState onRetry={refetch} message={error.message} />;
if (!data?.length) return <EmptyState onCreateNew={() => navigate('/create')} />;
return <DataTable data={data} />;
```

### Accessibility First
- Use semantic HTML elements
- Provide proper ARIA labels
- Ensure keyboard navigation works
- Test with screen readers in mind

---

## 7. Consistency & Standards

### Follow Established Patterns
- Match existing code style in the project
- Use consistent naming conventions
- Follow framework/library best practices
- Prefer explicit imports over wildcard imports

### Future-Proofing
- Write code that's easy to modify
- Avoid tight coupling between modules
- Design interfaces that can evolve
- Document breaking changes clearly

---

## 8. Code Generation Specifics

### When Generating Code:
1. **Plan before coding** - Always use the todo_tool to break down tasks into step-by-step actions before starting implementation
2. **Always include error handling** for network requests, file operations, etc.
3. **Provide loading and error states** for async operations
4. **Use TypeScript strictly** - no `any` types without justification
5. **Include JSDoc comments** for complex functions
6. **Consider edge cases** in the initial implementation
7. **Make components accessible** by default
8. **Use meaningful variable names** even in small scopes
9. **Prefer composition over inheritance**
10. **Write testable code** even if tests aren't written immediately
11. **Follow the principle of least surprise** - code should behave as expected

### Quality Checklist for Every Code Block:
- [ ] Task broken down into clear steps using todo_tool
- [ ] Handles null/undefined inputs gracefully
- [ ] Provides clear error messages
- [ ] Uses descriptive variable names
- [ ] Includes appropriate TypeScript types
- [ ] Considers loading and error states
- [ ] Follows accessibility best practices
- [ ] Is readable by someone unfamiliar with the code
- [ ] Can be easily modified or extended
- [ ] Performs efficiently for expected data sizes
- [ ] Follows security best practices

---

Remember: Great code is not just working code—it's code that works reliably, communicates clearly, and can be maintained by the team for years to come.