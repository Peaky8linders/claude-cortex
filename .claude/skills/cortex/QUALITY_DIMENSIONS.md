# Context Quality Dimensions

The 7 dimensions scored by ContextScore (0-100 each, weighted aggregate):

## 1. Semantic Relevance (weight: 0.25)
How well does the current context match the task at hand?
- High: all loaded context directly relates to the active task
- Low: context is generic or about unrelated topics

## 2. Redundancy (weight: 0.15)
How much duplicate information exists in context?
- High score = low redundancy (good)
- Look for: repeated file contents, duplicate explanations, restated decisions

## 3. Distractors (weight: 0.15)
How much irrelevant noise is consuming tokens?
- Error traces for resolved issues
- Old conversation branches that went nowhere
- Exploration of abandoned approaches

## 4. Information Density (weight: 0.10)
Ratio of actionable information to total tokens.
- High: every token earns its place
- Low: verbose explanations, boilerplate, ceremony

## 5. Fragmentation (weight: 0.10)
Is related information scattered or co-located?
- High score = well-organized context
- Low: same concept discussed in 5 different places

## 6. Structure (weight: 0.10)
Does context follow a logical hierarchy?
- Decisions > patterns > details > examples
- Most important context first

## 7. Economics (weight: 0.15)
Token cost vs. value delivered.
- Are we burning tokens on things that don't improve output quality?
- Could we achieve the same with fewer tokens?

## Scoring
- 80-100: Excellent — context is sharp and focused
- 60-79: Good — minor optimization opportunities
- 40-59: Fair — significant noise or gaps
- 20-39: Poor — quality gate territory
- 0-19: Critical — halt and restructure
