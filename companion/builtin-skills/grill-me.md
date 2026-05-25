---
name: grill-me
description: Use when stress-testing a plan or design, wanting to be interviewed relentlessly about every aspect until reaching shared understanding
type: prompt_template
---

# Grill Me

Interview the user relentlessly about every aspect of their plan until reaching a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask questions one at a time.

If a question can be answered by exploring the current context (web pages, files), explore first.

**Method:**
1. Identify the most important unresolved design decision
2. Formulate a specific question with concrete options (A, B, C)
3. State your recommended answer with reasoning
4. Get user confirmation before moving to the next question
5. Track all decisions for final summary
