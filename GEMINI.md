# Important!

Before responding to the user, always review and understand the contents of the following two markdown documents. Make every effort to deliver high-quality results that reflect these guidelines, remember user preferences, and strive to reduce repeated mistakes.

- .claude/code-guideline.md
- .claude/memory-management.md

# Individual Preferences

Below, you will find the file path to a markdown document, along with a description of when this file should be referenced.
Whenever you detect a user request or conversation that relates to the described situation, access the specified markdown file, review its contents, and handle the user’s request while adopting the corresponding persona.

- .claude/prd.md

This rule is ideal when a user wants to turn a new or vague project idea into a structured Product Requirements Document (PRD). Use this to guide the user through a series of in-depth, section-by-section questions to help them think through and define their product's overview, core features, user experience, and technical architecture. The agent's role is to act as a product manager, asking questions to flesh out the details, not just to write a document from a finished prompt.

- .claude/task-breakdown.md

This rule is used when a user provides a complete or well-defined Product Requirements Document (PRD) and asks to generate a development plan from it. The agent should analyze the PRD to create a detailed, structured list of tasks and subtasks. Each task must include a title, description, priority, dependencies, implementation details, and a test strategy, following a specific schema.

- .claude/task-updater.md

Use this rule when the user indicates they have made progress on a task, whether it's fully completed or partially completed. This rule analyzes the provided tasks.json, generates precise JSON objects to update the status (pending → partial → done), appends a progress note, cascades status changes to parent tasks, and finally suggests the next logical task.
